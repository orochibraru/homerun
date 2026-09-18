package deploy

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"regexp"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs/imagescan"
)

const (
	loggedFindings = 5
	mirrorTimeout  = 20 * time.Minute
)

// ScanSpec is the image scan gate: the block policy, whether a scan must
// succeed, and the targets to try in order until one scans.
type ScanSpec struct {
	Block    BlockPolicy  `json:"block"`
	Required bool         `json:"required"`
	Targets  []ScanTarget `json:"targets"`
}

// BlockPolicy is the scan severity that blocks a deploy, empty for none.
type BlockPolicy struct {
	FixableOnly bool   `json:"fixableOnly"`
	Severity    string `json:"severity"`
}

// ScanTarget is one place to scan the image from.
type ScanTarget struct {
	imagescan.Target
	Display string `json:"display"`
	Label   string `json:"label"`
}

// ScanRecord is one scan history row for the app to store: status "ok",
// "failed" or "skipped".
type ScanRecord struct {
	Digest   string             `json:"digest,omitempty"`
	Error    string             `json:"error,omitempty"`
	ImageRef string             `json:"imageRef"`
	Source   string             `json:"source"`
	Status   string             `json:"status"`
	Summary  *imagescan.Summary `json:"summary,omitempty"`
}

// MirrorSpec is the Homerun mirror a scanned pull goes through. CleaningUp
// means a mirror garbage collection is running, and Unavailable is why the
// mirror couldn't be brought up: either way the deploy pulls directly instead.
type MirrorSpec struct {
	Archive      HelperCommand         `json:"archive"`
	CleaningUp   bool                  `json:"cleaningUp"`
	Copy         HelperCommand         `json:"copy"`
	InternalAuth *dockerapi.AuthConfig `json:"internalAuth"`
	InternalRef  string                `json:"internalRef"`
	LoopbackRef  string                `json:"loopbackRef"`
	Rootless     bool                  `json:"rootless"`
	SkopeoImage  string                `json:"skopeoImage"`
	Target       ScanTarget            `json:"target"`
	Unavailable  string                `json:"unavailable"`
}

// HelperCommand is a helper container's entrypoint, command and environment.
type HelperCommand struct {
	Cmd        []string `json:"cmd"`
	Entrypoint []string `json:"entrypoint"`
	Env        []string `json:"env"`
}

var counted = []string{"CRITICAL", "HIGH", "MEDIUM", "LOW"}

func countOf(counts imagescan.Counts, severity string) int {
	switch severity {
	case "CRITICAL":
		return counts.Critical
	case "HIGH":
		return counts.High
	case "MEDIUM":
		return counts.Medium
	case "LOW":
		return counts.Low
	}
	return counts.Unknown
}

func describeBlockPolicy(policy BlockPolicy) string {
	threshold := policy.Severity + " or above"
	if policy.Severity == "CRITICAL" {
		threshold = "CRITICAL"
	}
	if policy.FixableOnly {
		return threshold + ", fixable only"
	}
	return threshold
}

// blockReason mirrors evaluateScanPolicy in src/lib/image-scan.ts: the reason
// a scan blocks the deploy, or "" when it doesn't.
func blockReason(summary imagescan.Summary, policy BlockPolicy) string {
	if policy.Severity == "" {
		return ""
	}
	source := summary.Counts
	if policy.FixableOnly {
		source = summary.FixableCounts
	}
	total := 0
	var found []string
	for _, severity := range counted {
		count := countOf(source, severity)
		total += count
		if count > 0 {
			found = append(found, fmt.Sprintf("%d %s", count, strings.ToLower(severity)))
		}
		if severity == policy.Severity {
			break
		}
	}
	if total == 0 {
		return ""
	}
	noun := "vulnerabilities"
	if total == 1 {
		noun = "vulnerability"
	}
	if policy.FixableOnly {
		noun = "fixable " + noun
	}
	return fmt.Sprintf(
		"Blocked by the image scan policy (block at %s): %d %s at or above the threshold (%s). Full scan: %s. Fix the image, or change the policy under Settings → Docker.",
		describeBlockPolicy(policy), total, noun, strings.Join(found, ", "), imagescan.CountsLine(summary.Counts))
}

// scanTargets runs the scan gate over the spec's targets, or records a skipped
// scan of ref when scanning is off.
func (r *run) scanTargets(ctx context.Context, ref, digest string) error {
	spec := r.spec.Image.Scan
	if spec == nil {
		r.result.Scans = append(r.result.Scans, ScanRecord{Error: "Scanning is turned off.", ImageRef: ref, Source: "none", Status: "skipped"})
		return nil
	}
	return r.scan(ctx, spec.Targets, digest)
}

// scan tries each target in order until one scans, logs and records the
// result and enforces the block policy. When nothing could be scanned the
// deploy goes ahead unless a successful scan is required. Mirrors
// ImageScanService.scan.
func (r *run) scan(ctx context.Context, targets []ScanTarget, digest string) error {
	spec := r.spec.Image.Scan
	var failures []string
	for _, target := range targets {
		shown := target.Display
		if shown == "" {
			shown = target.Ref
		}
		r.progress.line(fmt.Sprintf("Scanning %s for vulnerabilities (%s)...", shown, target.Label))
		summary, err := r.scanner(ctx, target.Target)
		if err != nil {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			failures = append(failures, target.Label+": "+err.Error())
			r.progress.line(fmt.Sprintf("Image scan of %s failed: %s", target.Label, err))
			continue
		}
		r.result.Scans = append(r.result.Scans, ScanRecord{Digest: digest, ImageRef: shown, Source: target.Label, Status: "ok", Summary: &summary})
		r.logSummary(shown, summary)
		if reason := blockReason(summary, spec.Block); reason != "" {
			r.progress.line(reason)
			return &kindError{kind: FailureScanBlocked, err: errors.New(reason)}
		}
		return nil
	}

	failure := strings.Join(failures, "; ")
	if failure == "" {
		failure = "no scan target"
	}
	record := ScanRecord{Digest: digest, Error: failure, Status: "failed"}
	if len(targets) > 0 {
		record.ImageRef, record.Source = targets[0].Display, targets[0].Label
		if record.ImageRef == "" {
			record.ImageRef = targets[0].Ref
		}
	}
	r.result.Scans = append(r.result.Scans, record)
	if spec.Required {
		message := "The image couldn't be scanned, and this instance requires a successful scan before deploying."
		r.progress.line(message)
		return &kindError{kind: FailureScanBlocked, err: errors.New(message)}
	}
	r.progress.line("The image couldn't be scanned. Deploying anyway, since a successful scan isn't required on this instance.")
	return nil
}

func (r *run) logSummary(ref string, summary imagescan.Summary) {
	r.progress.line(fmt.Sprintf("Image scan of %s: %s.", ref, imagescan.CountsLine(summary.Counts)))
	serious := 0
	for _, finding := range summary.Findings {
		if serious == loggedFindings {
			break
		}
		if finding.Severity != "CRITICAL" && finding.Severity != "HIGH" {
			continue
		}
		serious++
		fixed := ""
		if finding.FixedVersion != nil {
			fixed = ", fixed in " + *finding.FixedVersion
		}
		r.progress.line(fmt.Sprintf("  %s %s in %s %s%s", finding.Severity, finding.ID, finding.Pkg, finding.InstalledVersion, fixed))
	}
	if summary.TotalFindings > serious && serious > 0 {
		r.progress.line("  Full list on the service's Security tab.")
	}
}

var digestPattern = regexp.MustCompile(`sha256:[0-9a-f]{64}`)

func lastDigest(output string) string {
	matches := digestPattern.FindAllString(output, -1)
	if len(matches) == 0 {
		return ""
	}
	return matches[len(matches)-1]
}

// deployThroughMirror copies the image into the Homerun mirror, scans it
// there, then pins the swarm service to the scanned digest or brings the
// scanned image onto this host. ok is false when it fell back to a direct pull
// before scanning anything. Mirrors ImageScanService.deployThroughMirror.
func (r *run) deployThroughMirror(ctx context.Context) (resolvedImage, bool, error) {
	spec := r.spec.Image
	mirror := spec.Mirror
	ref := spec.Image + ":" + spec.Tag
	if mirror.CleaningUp {
		r.progress.line("The Homerun mirror is being cleaned up. Pulling directly; the image is scanned on this host instead.")
		return resolvedImage{}, false, nil
	}
	r.progress.line("Copying " + ref + " into the Homerun mirror for scanning...")
	copied, err := helperRun{}, errors.New(mirror.Unavailable)
	if mirror.Unavailable == "" {
		copied, err = r.runHelper(ctx, map[string]any{
			"Cmd":        mirror.Copy.Cmd,
			"Entrypoint": mirror.Copy.Entrypoint,
			"Env":        mirror.Copy.Env,
			"HostConfig": map[string]any{"NetworkMode": r.spec.Network},
			"Image":      mirror.SkopeoImage,
		}, mirrorTimeout)
	}
	if err == nil && (copied.timedOut || copied.code != 0) {
		err = errors.New(imagescan.LastErrorLine(copied.stderr + "\n" + copied.stdout))
		if copied.timedOut {
			err = errors.New("copying the image into the mirror timed out")
		}
	}
	if err != nil {
		if ctx.Err() != nil {
			return resolvedImage{}, false, ctx.Err()
		}
		log.Printf("[homerun-worker] mirror copy failed: service=%s ref=%s : %s", r.spec.ServiceID, ref, err)
		r.progress.line(fmt.Sprintf("The mirror couldn't take the image (%s). Falling back to a direct pull; the image is scanned on this host instead.", err))
		return resolvedImage{}, false, nil
	}
	digest := lastDigest(copied.stdout)

	target := mirror.Target
	target.Display = ref
	if digest != "" {
		target.Display = ref + "@" + digest
	}
	if err := r.scan(ctx, []ScanTarget{target}, digest); err != nil {
		return resolvedImage{}, false, err
	}

	if r.spec.Workload.Kind == "swarm" {
		if digest == "" {
			r.progress.line("The mirror didn't report a digest, so the swarm service isn't pinned to the scanned image.")
			return resolvedImage{image: spec.Image, tag: spec.Tag}, true, nil
		}
		r.progress.line("Pinning the swarm service to the scanned digest " + digest + ".")
		return resolvedImage{digest: digest, image: spec.Image, tag: spec.Tag + "@" + digest}, true, nil
	}

	pulled, err := r.fetchFromMirror(ctx)
	if err != nil {
		return resolvedImage{}, false, err
	}
	if digest == "" {
		digest = pulled
	}
	return resolvedImage{digest: digest, image: spec.Image, tag: spec.Tag}, true, nil
}

// fetchFromMirror gets the scanned image out of the mirror onto this host: a
// loopback pull, or a `docker load` streamed from the mirror on rootless
// Docker and whenever that pull fails. Only when both fail does it pull from
// the upstream registry. Returns the digest a pull reported.
func (r *run) fetchFromMirror(ctx context.Context) (string, error) {
	spec := r.spec.Image
	mirror := spec.Mirror
	ref := spec.Image + ":" + spec.Tag
	if mirror.Rootless {
		r.progress.line("Rootless Docker can't pull from the mirror's loopback port, loading the scanned image from the mirror instead.")
	} else {
		r.progress.line("Pulling the scanned image from the mirror...")
		err := r.pull(ctx, mirror.LoopbackRef, mirror.InternalAuth)
		if err == nil {
			repository, tag := dockerapi.SplitRef(ref)
			err = r.docker.TagImage(ctx, mirror.LoopbackRef, repository, tag)
		}
		if err == nil {
			digest, _ := r.localDigest(ctx, mirror.LoopbackRef)
			return digest, nil
		}
		if ctx.Err() != nil {
			return "", ctx.Err()
		}
		log.Printf("[homerun-worker] mirror pull failed: service=%s ref=%s : %s", r.spec.ServiceID, ref, err)
		r.progress.line(fmt.Sprintf("This host couldn't pull from the mirror (%s). Loading the scanned image from the mirror instead.", err))
	}
	err := r.loadFromMirror(ctx, ref)
	if err == nil {
		return "", nil
	}
	if ctx.Err() != nil {
		return "", ctx.Err()
	}
	log.Printf("[homerun-worker] mirror load failed: service=%s ref=%s : %s", r.spec.ServiceID, ref, err)
	r.progress.line(fmt.Sprintf("The scanned image couldn't be loaded from the mirror (%s). Falling back to a direct pull of %s.", err, ref))
	if err := r.pull(ctx, ref, spec.Auth); err != nil {
		return "", err
	}
	digest, _ := r.localDigest(ctx, ref)
	return digest, nil
}

// loadFromMirror streams the image out of the mirror into this daemon: a
// skopeo container on the shared network writes a `docker load` tarball to its
// stdout, piped straight into the daemon's image load.
func (r *run) loadFromMirror(ctx context.Context, ref string) error {
	mirror := r.spec.Image.Mirror
	if _, err := r.docker.InspectImage(ctx, mirror.SkopeoImage); err != nil {
		if err := r.docker.PullImage(ctx, mirror.SkopeoImage, nil, nil); err != nil {
			return err
		}
	}
	ctx, cancel := context.WithTimeout(ctx, mirrorTimeout)
	defer cancel()
	id, err := r.docker.CreateContainerFrom(ctx, "", map[string]any{
		"Cmd":        mirror.Archive.Cmd,
		"Entrypoint": mirror.Archive.Entrypoint,
		"HostConfig": map[string]any{"NetworkMode": r.spec.Network},
		"Image":      mirror.SkopeoImage,
		"Labels":     map[string]string{managedLabel: "true"},
		"Tty":        false,
	})
	if err != nil {
		return err
	}
	defer r.removeQuietly(ctx, id)
	stream, err := r.docker.AttachContainer(ctx, id)
	if err != nil {
		return err
	}
	defer func() { _ = stream.Close() }()

	archive, writer := io.Pipe()
	var stderr strings.Builder
	go func() { _ = writer.CloseWithError(dockerapi.DemuxSplit(stream, writer, &stderr)) }()
	r.progress.line("Loading " + ref + " from the mirror...")
	if err := r.docker.StartContainer(ctx, id); err != nil {
		return err
	}
	loaded := make(chan error, 1)
	go func() {
		err := r.docker.LoadImage(ctx, archive)
		_, _ = io.Copy(io.Discard, archive)
		loaded <- err
	}()
	code, waitErr := r.docker.WaitContainer(ctx, id)
	loadErr := <-loaded
	if waitErr != nil {
		return waitErr
	}
	if output := strings.TrimSpace(stderr.String()); code != 0 && output != "" {
		return errors.New(imagescan.LastErrorLine(output))
	}
	if loadErr != nil {
		return loadErr
	}
	if code != 0 {
		return fmt.Errorf("skopeo exited with code %d", code)
	}
	_, err = r.docker.InspectImage(ctx, ref)
	return err
}
