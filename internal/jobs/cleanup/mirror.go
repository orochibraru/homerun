package cleanup

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/registryapi"
)

// MirrorSpec is everything a homerun-mirror garbage collection needs: the
// container, the registry API addresses to try in order, its internal
// credentials when auth is on, the keep set and the paths inside the
// container.
type MirrorSpec struct {
	ConfigPath      string              `json:"configPath"`
	Container       string              `json:"container"`
	Keep            registryapi.KeepSet `json:"keep"`
	Password        string              `json:"password"`
	RepositoriesDir string              `json:"repositoriesDir"`
	StorageDir      string              `json:"storageDir"`
	URLs            []string            `json:"urls"`
	Username        string              `json:"username"`
}

// RestartGrace is how long homerun-mirror is given to notice a config change
// after being restarted; a test lowers it to avoid a real sleep.
var RestartGrace = 1500 * time.Millisecond

var errorLineRe = regexp.MustCompile(`(?i)error|fatal|denied|unauthorized`)

// LastErrorLine returns the last line of output that looks like an error, or
// its very last line, or "no output" when there is none.
func LastErrorLine(output string) string {
	var lines []string
	for _, line := range strings.Split(output, "\n") {
		if line = strings.TrimSpace(line); line != "" {
			lines = append(lines, line)
		}
	}
	for i := len(lines) - 1; i >= 0; i-- {
		if errorLineRe.MatchString(lines[i]) {
			return lines[i]
		}
	}
	if len(lines) > 0 {
		return lines[len(lines)-1]
	}
	return "no output"
}

// ParseDuKilobytes reads the leading number from a `du` line (kilobytes) and
// converts it to bytes.
func ParseDuKilobytes(output string) (int64, bool) {
	fields := strings.Fields(output)
	if len(fields) == 0 {
		return 0, false
	}
	value, err := strconv.ParseInt(fields[0], 10, 64)
	return value * 1024, err == nil
}

// mirrorUsage reads the mirror's storage directory size in bytes via `du`.
func (c cleaner) mirrorUsage(ctx context.Context, spec MirrorSpec) (int64, bool) {
	result, err := c.docker.ContainerExec(ctx, spec.Container, []string{"du", "-sk", spec.StorageDir})
	if err != nil || result.ExitCode != 0 {
		return 0, false
	}
	return ParseDuKilobytes(result.Stdout)
}

// mirrorClient returns a registry client for the first reachable URL in spec.
func mirrorClient(ctx context.Context, spec MirrorSpec) (*registryapi.Client, error) {
	for _, base := range spec.URLs {
		client := registryapi.New(base, spec.Username, spec.Password)
		if client.Ping(ctx) {
			return client, nil
		}
	}
	return nil, fmt.Errorf("The mirror's registry API isn't reachable at %s.", strings.Join(spec.URLs, " or "))
}

// exec runs cmd inside the mirror container, failing with what and the
// command's last error-looking output line on a non-zero exit.
func (c cleaner) exec(ctx context.Context, spec MirrorSpec, what string, cmd ...string) error {
	result, err := c.docker.ContainerExec(ctx, spec.Container, cmd)
	if err != nil {
		return err
	}
	if result.ExitCode != 0 {
		return fmt.Errorf("%s failed: %s", what, LastErrorLine(result.Stderr+"\n"+result.Stdout))
	}
	return nil
}

// removeRepositories deletes the given repositories' directories inside the
// mirror container, then prunes any now-empty parent directories.
func (c cleaner) removeRepositories(ctx context.Context, spec MirrorSpec, names []string) error {
	var paths []string
	for _, name := range names {
		if registryapi.IsValidRepository(name) {
			paths = append(paths, spec.RepositoriesDir+"/"+name)
		}
	}
	if len(paths) == 0 {
		return nil
	}
	if err := c.exec(ctx, spec, "Removing empty mirror repositories", append([]string{"rm", "-rf"}, paths...)...); err != nil {
		return err
	}
	_, err := c.docker.ContainerExec(ctx, spec.Container,
		[]string{"find", spec.RepositoriesDir, "-mindepth", "1", "-type", "d", "-empty", "-delete"})
	return err
}

// mirror runs a homerun-mirror garbage collection: plans deletions/pins
// against spec.Keep, applies them, prunes emptied repositories, and restarts
// the container to reclaim disk space.
func (c cleaner) mirror(ctx context.Context, spec MirrorSpec) (summary, error) {
	running, err := c.docker.ContainerIsRunning(ctx, spec.Container)
	if err != nil {
		return nil, err
	}
	if !running {
		return nil, fmt.Errorf("%s isn't running, nothing to clean up.", spec.Container)
	}
	before, beforeOK := c.mirrorUsage(ctx, spec)
	client, err := mirrorClient(ctx, spec)
	if err != nil {
		return nil, err
	}
	repositories, err := client.Catalog(ctx)
	if err != nil {
		return nil, err
	}
	var inventory []registryapi.Tag
	for _, repository := range repositories {
		tags, err := client.Inventory(ctx, repository)
		if err != nil {
			return nil, err
		}
		inventory = append(inventory, tags...)
	}
	plan := registryapi.PlanGC(inventory, repositories, spec.Keep)
	c.logf("Mirror cleanup: %d repositories, %d tags, %d manifests to delete, %d to keep.",
		len(repositories), len(inventory), len(plan.Deletes), plan.KeptManifests)

	for _, pin := range plan.Pins {
		pinned, err := client.TagManifest(ctx, pin)
		if err != nil {
			return nil, err
		}
		if pinned {
			c.logf("Kept %s@%s as :%s", pin.Repository, pin.Digest, pin.Tag)
		}
	}
	deleted := 0
	for _, entry := range plan.Deletes {
		gone, err := client.DeleteManifest(ctx, entry)
		if err != nil {
			return nil, err
		}
		if gone {
			deleted++
			c.logf("Deleted %s@%s", entry.Repository, entry.Digest)
		}
	}
	if err := c.exec(ctx, spec, "registry garbage-collect",
		"registry", "garbage-collect", "--delete-untagged", spec.ConfigPath); err != nil {
		return nil, err
	}
	if err := c.removeRepositories(ctx, spec, plan.EmptiedRepositories); err != nil {
		return nil, err
	}
	if err := c.docker.ContainerRestart(ctx, spec.Container); err != nil {
		return nil, err
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case <-time.After(RestartGrace):
	}

	reclaimed := int64(0)
	if after, afterOK := c.mirrorUsage(ctx, spec); beforeOK && afterOK && before > after {
		reclaimed = before - after
	}
	c.logf("Mirror cleanup done: deleted %d manifests, removed %d repositories, kept %d, reclaimed %d bytes.",
		deleted, len(plan.EmptiedRepositories), plan.KeptManifests, reclaimed)
	return summary{
		"itemsDeleted":        deleted,
		"keptManifests":       plan.KeptManifests,
		"removedRepositories": len(plan.EmptiedRepositories),
		"spaceReclaimedBytes": reclaimed,
	}, nil
}
