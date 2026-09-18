package deploy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

const readinessLabel = "homerun.readiness"

// ReadinessInput is what picking a readiness check needs to know about the
// service. Routed is false when nothing reaches it through Traefik (not DNS
// resolvable, host networking).
type ReadinessInput struct {
	ContainerPort      int    `json:"containerPort"`
	HealthcheckCommand string `json:"healthcheckCommand"`
	PortProtocol       string `json:"portProtocol"`
	Routed             bool   `json:"routed"`
}

// readiness is what holds a new container or swarm task back from Traefik:
// "service-healthcheck", "image-healthcheck", "listening" or "none" (with a
// reason: "not-routed", "udp-only", "no-shell" or "image-unknown").
type readiness struct {
	kind   string
	reason string
}

// imageFacts is what readiness needs to know about an image: whether it
// declares a HEALTHCHECK and, when it doesn't, whether it ships /bin/sh.
type imageFacts struct {
	hasHealthcheck bool
	hasShell       bool
}

func (in ReadinessInput) hasCommand() bool {
	return strings.TrimSpace(in.HealthcheckCommand) != ""
}

// needsImage mirrors readinessNeedsImage: only a routed TCP service without
// its own healthcheck command depends on the image.
func (in ReadinessInput) needsImage() bool {
	return !in.hasCommand() && in.Routed && in.PortProtocol != "udp"
}

// readinessCheck mirrors readinessCheck in docker/readiness.ts. image is nil
// when the image couldn't be inspected or wasn't looked at.
func readinessCheck(in ReadinessInput, image *imageFacts) readiness {
	switch {
	case in.hasCommand():
		return readiness{kind: "service-healthcheck"}
	case !in.Routed:
		return readiness{kind: "none", reason: "not-routed"}
	case image != nil && image.hasHealthcheck:
		return readiness{kind: "image-healthcheck"}
	case in.PortProtocol == "udp":
		return readiness{kind: "none", reason: "udp-only"}
	case image == nil:
		return readiness{kind: "none", reason: "image-unknown"}
	case !image.hasShell:
		return readiness{kind: "none", reason: "no-shell"}
	default:
		return readiness{kind: "listening"}
	}
}

// imageDeclaresHealthcheck reports whether a Config.Healthcheck.Test is a real
// healthcheck rather than none or an explicit NONE.
func imageDeclaresHealthcheck(test []string) bool {
	return len(test) > 0 && test[0] != "NONE"
}

// readinessDescription mirrors readinessDescription in docker/readiness.ts.
func readinessDescription(check readiness, port int, workload string) string {
	switch check.kind {
	case "service-healthcheck":
		return fmt.Sprintf("Readiness: the service's healthcheck command must pass before the new %s gets traffic.", workload)
	case "image-healthcheck":
		return fmt.Sprintf("Readiness: the image's own HEALTHCHECK must pass before the new %s gets traffic.", workload)
	case "listening":
		return fmt.Sprintf("Readiness: no healthcheck configured, so Homerun added one that waits for port %d to be listening; the new %s gets traffic only once it passes.", port, workload)
	}
	switch check.reason {
	case "not-routed":
		return "Readiness: not published through Traefik, so there's no traffic to hold back."
	case "udp-only":
		return fmt.Sprintf("Readiness: a UDP-only port can't be checked, so the new %s gets traffic as soon as it runs. Add a healthcheck command for a real gate.", workload)
	case "no-shell":
		return fmt.Sprintf("Readiness: the image has no healthcheck and no /bin/sh to run one in, so the new %s gets traffic as soon as it runs.", workload)
	default:
		return fmt.Sprintf("Readiness: the image couldn't be inspected, so the new %s gets traffic as soon as it runs.", workload)
	}
}

// healthcheck is the Docker Healthcheck to create the workload with, nil to
// leave the image's own (or none) in place.
func (r *run) healthcheck(check readiness) map[string]any {
	switch check.kind {
	case "service-healthcheck":
		return r.spec.Healthchecks.Service
	case "listening":
		return r.spec.Healthchecks.Listening
	}
	return nil
}

// readinessLabels marks a workload whose health comes from the generated check.
func readinessLabels(check readiness) map[string]string {
	if check.kind == "listening" {
		return map[string]string{readinessLabel: "listening"}
	}
	return map[string]string{}
}

// planReadiness picks the readiness check for imageRef and reports it on the
// deploy log. It only inspects the image when the answer depends on it;
// checking for /bin/sh creates a throwaway, never-started container.
func (r *run) planReadiness(ctx context.Context, imageRef, workload string) readiness {
	in := r.spec.Readiness
	var facts *imageFacts
	if in.needsImage() {
		facts = r.imageReadinessFacts(ctx, imageRef)
	}
	check := readinessCheck(in, facts)
	r.progress.line(readinessDescription(check, in.ContainerPort, workload))
	return check
}

func (r *run) imageReadinessFacts(ctx context.Context, imageRef string) *imageFacts {
	image, err := r.docker.InspectImage(ctx, imageRef)
	if err != nil {
		return nil
	}
	if image.Config.Healthcheck != nil && imageDeclaresHealthcheck(image.Config.Healthcheck.Test) {
		return &imageFacts{hasHealthcheck: true}
	}
	probe, err := r.docker.CreateContainerFrom(ctx, "homerun-readiness-"+randomSuffix(), map[string]any{
		"Entrypoint":      []string{"/bin/sh"},
		"Image":           imageRef,
		"NetworkDisabled": true,
	})
	if err != nil {
		return nil
	}
	hasShell, err := r.docker.PathExists(ctx, probe, "/bin/sh")
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), 30*time.Second)
	defer cancel()
	_ = r.docker.RemoveContainer(cleanup, probe)
	return &imageFacts{hasShell: err == nil && hasShell}
}

func randomSuffix() string {
	buffer := make([]byte, 4)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}
