package deploy

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
)

// ReadinessLabel marks a workload whose readiness comes from Homerun's
// generated "listening" check rather than the image's or service's own.
const ReadinessLabel = "homerun.readiness"

// ReadinessInput is what picking a readiness check needs to know about the
// service. Routed is false when nothing reaches it through Traefik (not DNS
// resolvable, host networking).
type ReadinessInput struct {
	ContainerPort      int    `json:"containerPort"`
	HealthcheckCommand string `json:"healthcheckCommand"`
	PortProtocol       string `json:"portProtocol"`
	Routed             bool   `json:"routed"`
}

// Readiness is what holds a new container or swarm task back from Traefik:
// "service-healthcheck", "image-healthcheck", "listening" or "none" (with a
// Reason: "not-routed", "udp-only", "no-shell" or "image-unknown").
type Readiness struct {
	Kind   string
	Reason string
}

// ImageFacts is what readiness needs to know about an image: whether it
// declares a HEALTHCHECK and, when it doesn't, whether it ships /bin/sh.
type ImageFacts struct {
	HasHealthcheck bool
	HasShell       bool
}

// hasCommand reports whether the service defines its own healthcheck command.
func (in ReadinessInput) hasCommand() bool {
	return strings.TrimSpace(in.HealthcheckCommand) != ""
}

// NeedsImage reports whether the check depends on the image: only a routed
// TCP service without its own healthcheck command depends on the image.
func (in ReadinessInput) NeedsImage() bool {
	return !in.hasCommand() && in.Routed && in.PortProtocol != "udp"
}

// ReadinessCheck picks how a new workload proves it's ready. image is nil
// when the image couldn't be inspected or wasn't looked at.
func ReadinessCheck(in ReadinessInput, image *ImageFacts) Readiness {
	switch {
	case in.hasCommand():
		return Readiness{Kind: "service-healthcheck"}
	case !in.Routed:
		return Readiness{Kind: "none", Reason: "not-routed"}
	case image != nil && image.HasHealthcheck:
		return Readiness{Kind: "image-healthcheck"}
	case in.PortProtocol == "udp":
		return Readiness{Kind: "none", Reason: "udp-only"}
	case image == nil:
		return Readiness{Kind: "none", Reason: "image-unknown"}
	case !image.HasShell:
		return Readiness{Kind: "none", Reason: "no-shell"}
	default:
		return Readiness{Kind: "listening"}
	}
}

// ImageDeclaresHealthcheck reports whether a Config.Healthcheck.Test is a real
// healthcheck rather than none or an explicit NONE.
func ImageDeclaresHealthcheck(test []string) bool {
	return len(test) > 0 && test[0] != "NONE"
}

// ReadinessDescription is the deploy log line explaining check.
func ReadinessDescription(check Readiness, port int, workload string) string {
	switch check.Kind {
	case "service-healthcheck":
		return fmt.Sprintf("Readiness: the service's healthcheck command must pass before the new %s gets traffic.", workload)
	case "image-healthcheck":
		return fmt.Sprintf("Readiness: the image's own HEALTHCHECK must pass before the new %s gets traffic.", workload)
	case "listening":
		return fmt.Sprintf("Readiness: no healthcheck configured, so Homerun added one that waits for port %d to be listening; the new %s gets traffic only once it passes.", port, workload)
	}
	switch check.Reason {
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
func (r *run) healthcheck(check Readiness) map[string]any {
	switch check.Kind {
	case "service-healthcheck":
		return r.spec.Healthchecks.Service
	case "listening":
		return r.spec.Healthchecks.Listening
	}
	return nil
}

// ReadinessLabels marks a workload whose health comes from the generated check.
func ReadinessLabels(check Readiness) map[string]string {
	if check.Kind == "listening" {
		return map[string]string{ReadinessLabel: "listening"}
	}
	return map[string]string{}
}

// planReadiness picks the readiness check for imageRef and reports it on the
// deploy log. It only inspects the image when the answer depends on it;
// checking for /bin/sh creates a throwaway, never-started container.
func (r *run) planReadiness(ctx context.Context, imageRef, workload string) Readiness {
	in := r.spec.Readiness
	var facts *ImageFacts
	if in.NeedsImage() {
		facts = r.imageReadinessFacts(ctx, imageRef)
	}
	check := ReadinessCheck(in, facts)
	r.progress.line(ReadinessDescription(check, in.ContainerPort, workload))
	return check
}

// imageReadinessFacts inspects imageRef for a HEALTHCHECK, or probes it for
// /bin/sh via a throwaway container when it has none.
func (r *run) imageReadinessFacts(ctx context.Context, imageRef string) *ImageFacts {
	image, err := r.docker.InspectImage(ctx, imageRef)
	if err != nil {
		return nil
	}
	if image.Config.Healthcheck != nil && ImageDeclaresHealthcheck(image.Config.Healthcheck.Test) {
		return &ImageFacts{HasHealthcheck: true}
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
	return &ImageFacts{HasShell: err == nil && hasShell}
}

// randomSuffix returns a random 8-character hex string, for a unique
// container/probe name.
func randomSuffix() string {
	buffer := make([]byte, 4)
	_, _ = rand.Read(buffer)
	return hex.EncodeToString(buffer)
}
