package deploy

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

const (
	envFileHelper  = "alpine:3"
	envFileHost    = "/homerun-host"
	envFileTimeout = 60 * time.Second
)

// resolveImage resolves the image the workload runs: a registry pull, a
// rollback's revision image or a fresh git build.
func (r *run) resolveImage(ctx context.Context) (resolvedImage, error) {
	switch r.spec.Image.Kind {
	case "pull":
		return r.pullForDeploy(ctx)
	case "revision":
		return r.revisionImage(ctx)
	case "local-build", "docker-build", "agent-build":
		return r.buildImage(ctx)
	}
	return resolvedImage{}, fmt.Errorf("Unhandled deploy plan variant: %q", r.spec.Image.Kind)
}

// pull pulls ref, logging each layer's status only when it changes.
func (r *run) pull(ctx context.Context, ref string, auth *dockerapi.AuthConfig) error {
	r.progress.line("Pulling " + ref + "...")
	last := map[string]string{}
	return r.docker.PullImageEvents(ctx, ref, auth, func(id, status string) {
		if last[id] == status {
			return
		}
		last[id] = status
		if id != "" {
			r.progress.line(status + ": " + id)
		} else {
			r.progress.line(status)
		}
	})
}

// localDigest is the local image's registry digest and whether it's on this
// host at all.
func (r *run) localDigest(ctx context.Context, ref string) (string, bool) {
	inspected, err := r.docker.InspectImage(ctx, ref)
	if err != nil {
		return "", false
	}
	return inspected.Digest(), true
}

// shouldSkipPull mirrors shouldSkipPull in src/lib/pull-policy.ts: the log
// line explaining why the pull is skipped, or "" to pull.
func shouldSkipPull(policy string, present bool) string {
	switch policy {
	case "never":
		if present {
			return "Pull policy is Never : using the image already on this host."
		}
		return "Pull policy is Never, and the image isn't on this host."
	case "missing":
		if present {
			return "Pull policy is If missing : the image is already on this host."
		}
	}
	return ""
}

// pullForDeploy resolves a bring-your-own-image deploy: honours the pull
// policy, goes through the mirror when scanning is on, and scans the result.
// Mirrors pullForDeploy in deploy/pull-step.ts.
func (r *run) pullForDeploy(ctx context.Context) (resolvedImage, error) {
	spec := r.spec.Image
	ref := spec.Image + ":" + spec.Tag
	local, present := r.localDigest(ctx, ref)
	if skip := shouldSkipPull(spec.PullPolicy, present); skip != "" {
		r.progress.line(skip)
		if !present {
			return resolvedImage{}, fmt.Errorf("Pull policy is \"never\" and %s isn't on this host.", ref)
		}
		if err := r.scanTargets(ctx, ref, local); err != nil {
			return resolvedImage{}, err
		}
		return resolvedImage{digest: local, image: spec.Image, tag: spec.Tag}, nil
	}
	if spec.Scan != nil && spec.Mirror != nil {
		mirrored, ok, err := r.deployThroughMirror(ctx)
		if err != nil {
			return resolvedImage{}, err
		}
		if ok {
			return mirrored, nil
		}
	}
	if err := r.pull(ctx, ref, spec.Auth); err != nil {
		return resolvedImage{}, err
	}
	digest, _ := r.localDigest(ctx, ref)
	if err := r.scanTargets(ctx, ref, digest); err != nil {
		return resolvedImage{}, err
	}
	return resolvedImage{digest: digest, image: spec.Image, tag: spec.Tag}, nil
}

func describeRevision(revision Revision) string {
	commit := ""
	if revision.GitCommit != "" {
		ref := ""
		if revision.GitRef != "" {
			ref = revision.GitRef + "@"
		}
		commit = fmt.Sprintf(" (%s%s)", ref, shorten(revision.GitCommit, 7))
	}
	digest := ""
	if revision.Digest != "" {
		digest = " " + shorten(revision.Digest, 19)
	}
	return revision.ImageRef + digest + commit
}

func shorten(text string, length int) string {
	if len(text) <= length {
		return text
	}
	return text[:length]
}

// revisionImage locates the exact image a rollback reuses, mirroring
// resolveRevisionImage in deploy/revision-step.ts.
func (r *run) revisionImage(ctx context.Context) (resolvedImage, error) {
	revision := *r.spec.Image.Revision
	r.progress.line(fmt.Sprintf("Rolling back to revision %s: %s", shorten(revision.ID, 8), describeRevision(revision)))
	r.progress.line("Skipping the build, the registry pull and the image scan: this exact image already ran here.")
	resolved, err := r.locateRevision(ctx, revision)
	if err != nil {
		return resolvedImage{}, err
	}
	r.result.ServiceImage = &ImageRef{Image: revision.Image, Tag: revision.Tag}
	return resolved, nil
}

func (r *run) locateRevision(ctx context.Context, revision Revision) (resolvedImage, error) {
	image, tag := revision.Image, revision.Tag
	if revision.Digest != "" {
		pinned := resolvedImage{digest: revision.Digest, image: image, tag: tag + "@" + revision.Digest}
		if r.spec.Workload.Kind == "swarm" {
			return pinned, nil
		}
		short := image + "@" + shorten(revision.Digest, 19)
		if _, err := r.docker.InspectImage(ctx, image+"@"+revision.Digest); err == nil {
			r.progress.line("Found " + short + " on this host.")
			return pinned, nil
		}
		r.progress.line(short + " isn't on this host anymore, pulling it by digest...")
		if err := r.pull(ctx, pinned.ref(), r.spec.Image.Auth); err != nil {
			return resolvedImage{}, err
		}
		return pinned, nil
	}
	ref := image + ":" + tag
	inspected, err := r.docker.InspectImage(ctx, ref)
	if err == nil && (revision.ImageID == "" || inspected.ID == revision.ImageID) {
		r.progress.line("Found " + ref + " on this host.")
		return resolvedImage{image: image, tag: tag}, nil
	}
	if err == nil {
		return resolvedImage{}, fmt.Errorf("%s now points at a different image than this revision ran, and the revision has no digest to pull by. Redeploy to rebuild it instead.", ref)
	}
	return resolvedImage{}, fmt.Errorf("The image for this revision (%s) is no longer on this host and has no digest to pull by. Redeploy to rebuild it instead.", ref)
}

// helperRun is a finished helper container's exit code and output.
type helperRun struct {
	code     int
	stderr   string
	stdout   string
	timedOut bool
}

// runHelper runs a throwaway container from a raw create body to completion,
// pulling its image first when missing, killing it past timeout and always
// removing it.
func (r *run) runHelper(ctx context.Context, body map[string]any, timeout time.Duration) (helperRun, error) {
	image, _ := body["Image"].(string)
	if _, err := r.docker.InspectImage(ctx, image); err != nil {
		if !errors.Is(err, dockerapi.ErrNotFound) {
			return helperRun{}, err
		}
		if err := r.docker.PullImage(ctx, image, nil, nil); err != nil {
			return helperRun{}, err
		}
	}
	body["Labels"] = withLabels(body["Labels"], map[string]string{managedLabel: "true"})
	body["Tty"] = false
	id, err := r.docker.CreateContainerFrom(ctx, "", body)
	if err != nil {
		return helperRun{}, err
	}
	defer r.removeQuietly(ctx, id)
	if err := r.docker.StartContainer(ctx, id); err != nil {
		return helperRun{}, err
	}
	waitCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	code, err := r.docker.WaitContainer(waitCtx, id)
	timedOut := false
	if err != nil {
		if ctx.Err() != nil || !errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
			return helperRun{}, err
		}
		timedOut = true
		_ = r.docker.KillContainer(context.WithoutCancel(ctx), id)
	}
	logs, err := r.docker.ContainerLogs(ctx, id, false)
	if err != nil {
		return helperRun{}, err
	}
	defer func() { _ = logs.Close() }()
	var stdout, stderr bytes.Buffer
	if err := dockerapi.DemuxSplit(logs, &stdout, &stderr); err != nil {
		return helperRun{}, err
	}
	return helperRun{code: code, stderr: stderr.String(), stdout: stdout.String(), timedOut: timedOut}, nil
}

// readEnvFiles reads the service's env files from this host and merges them in
// order, a later file overriding an earlier one. Each is read through a
// throwaway container with the host root mounted read-only, since the worker
// usually runs in a container of its own. Mirrors readHostEnvFiles in
// deploy/env-file-step.ts.
func (r *run) readEnvFiles(ctx context.Context) ([][2]string, error) {
	var merged [][2]string
	for _, path := range r.spec.EnvFiles {
		r.progress.line("Reading env file " + path + "...")
		result, err := r.runHelper(ctx, map[string]any{
			"Cmd":        []string{"cat", envFileHost + path},
			"HostConfig": map[string]any{"Binds": []string{"/:" + envFileHost + ":ro"}},
			"Image":      envFileHelper,
		}, envFileTimeout)
		if err != nil {
			return nil, err
		}
		if result.code != 0 || result.timedOut {
			detail := strings.TrimSpace(result.stderr)
			if detail != "" {
				return nil, fmt.Errorf("Couldn't read the env file %s on this host: %s", path, detail)
			}
			return nil, fmt.Errorf("Couldn't read the env file %s on this host.", path)
		}
		for _, pair := range parseDotEnv(result.stdout) {
			merged = setEnv(merged, pair[0], pair[1])
		}
	}
	return merged, nil
}

var envKey = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*$`)

// parseDotEnv mirrors parseDotEnv in src/lib/env-parse.ts: KEY=value lines,
// an optional export prefix and one layer of matching quotes, skipping blanks,
// comments and anything that isn't a valid assignment.
func parseDotEnv(text string) [][2]string {
	var rows [][2]string
	for _, raw := range regexp.MustCompile(`\r?\n`).Split(text, -1) {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if rest, ok := strings.CutPrefix(line, "export "); ok {
			line = strings.TrimSpace(rest)
		}
		key, value, ok := strings.Cut(line, "=")
		key = strings.TrimSpace(key)
		if !ok || !envKey.MatchString(key) {
			continue
		}
		rows = append(rows, [2]string{key, unquote(strings.TrimSpace(value))})
	}
	return rows
}

func unquote(value string) string {
	if len(value) >= 2 {
		first, last := value[0], value[len(value)-1]
		if (first == '"' && last == '"') || (first == '\'' && last == '\'') {
			return value[1 : len(value)-1]
		}
	}
	return value
}
