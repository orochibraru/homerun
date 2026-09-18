package deploy

import (
	"fmt"
	"strings"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

const (
	rolloutPoll         = 2 * time.Second
	rolloutSettle       = 5 * time.Second
	rolloutMaxWait      = 5 * time.Minute
	swarmUpdateMaxWait  = 10 * time.Minute
	swarmUpdateMonitorN = 15_000_000_000
)

// sample is a container's health as the rollout judges it, mirroring
// ContainerHealthSample in docker/rollout.ts.
type sample struct {
	exitCode     *int
	health       string
	healthOutput string
	restartCount int
	state        string
}

func sampleFromInspect(info *dockerapi.ContainerInspect) sample {
	if info == nil {
		return sample{health: "none", state: "missing"}
	}
	status := info.State.Status
	if status == "" {
		status = "exited"
	}
	switch status {
	case "running", "restarting", "exited", "created":
	default:
		status = "exited"
	}
	health, output := "none", ""
	if info.State.Health != nil {
		switch info.State.Health.Status {
		case "starting", "healthy", "unhealthy":
			health = info.State.Health.Status
		}
		if logs := info.State.Health.Log; len(logs) > 0 {
			output = strings.TrimSpace(logs[len(logs)-1].Output)
		}
	}
	exitCode := info.State.ExitCode
	return sample{exitCode: &exitCode, health: health, healthOutput: output, restartCount: info.RestartCount, state: status}
}

type verdict struct {
	reason string
	state  string
}

// readinessVerdict mirrors readinessVerdict in docker/rollout.ts.
func readinessVerdict(s sample, elapsed, settle, maxWait time.Duration) verdict {
	switch {
	case s.state == "missing":
		return verdict{state: "failed", reason: "The new container disappeared."}
	case s.state == "exited":
		code := "unknown"
		if s.exitCode != nil {
			code = fmt.Sprint(*s.exitCode)
		}
		return verdict{state: "failed", reason: fmt.Sprintf("The new container exited with code %s.", code)}
	case s.state == "restarting" || s.restartCount > 0:
		return verdict{state: "failed", reason: "The new container keeps restarting."}
	case s.health == "unhealthy":
		if s.healthOutput != "" {
			return verdict{state: "failed", reason: "The new container's healthcheck failed: " + s.healthOutput}
		}
		return verdict{state: "failed", reason: "The new container's healthcheck failed."}
	case s.health == "healthy":
		return verdict{state: "ready"}
	case s.health == "none" && s.state == "running" && elapsed >= settle:
		return verdict{state: "ready"}
	case elapsed >= maxWait:
		return verdict{state: "failed", reason: fmt.Sprintf("The new container wasn't ready after %ds.", int(maxWait.Seconds()))}
	}
	return verdict{state: "pending"}
}

type strategy struct {
	blueGreen bool
	reason    string
}

// rolloutStrategy mirrors rolloutStrategy in docker/rollout.ts.
func rolloutStrategy(hasRunningPrevious, hostNetwork bool, volumes []Volume) strategy {
	switch {
	case !hasRunningPrevious:
		return strategy{}
	case hostNetwork:
		return strategy{reason: "Host networking can't run two copies side by side, so the previous container stops first."}
	case anyWritable(volumes):
		return strategy{reason: "A writable volume can't safely be shared by two copies, so the previous container stops first."}
	}
	return strategy{blueGreen: true}
}

func anyWritable(volumes []Volume) bool {
	for _, volume := range volumes {
		if !volume.ReadOnly {
			return true
		}
	}
	return false
}

// swarmUpdateOrder mirrors swarmUpdateOrder in docker/rollout.ts.
func swarmUpdateOrder(volumes []Volume) string {
	if anyWritable(volumes) {
		return "stop-first"
	}
	return "start-first"
}

// swarmUpdateOutcome mirrors swarmUpdateOutcome in docker/rollout.ts: state is
// "pending", "completed" or "failed".
func swarmUpdateOutcome(service *dockerapi.SwarmService, previousStartedAt string) verdict {
	status := service.UpdateStatus
	if status == nil || status.State == "" || status.StartedAt == previousStartedAt {
		return verdict{state: "pending"}
	}
	switch status.State {
	case "completed":
		return verdict{state: "completed"}
	case "paused", "rollback_started", "rollback_paused", "rollback_completed":
		reason := "The new swarm tasks didn't become healthy, so swarm kept the previous ones"
		if status.Message != "" {
			return verdict{state: "failed", reason: reason + ": " + status.Message}
		}
		return verdict{state: "failed", reason: reason + "."}
	}
	return verdict{state: "pending"}
}

// readyLine mirrors readyLine in docker/container-rollout.ts.
func readyLine(check readiness, seconds int) string {
	if check.kind == "none" && check.reason == "not-routed" {
		return fmt.Sprintf("New container kept running for %ds, removing the previous one.", seconds)
	}
	if check.kind == "none" {
		return fmt.Sprintf("New container kept running for %ds, removing the previous one (Traefik was already sending it traffic).", seconds)
	}
	return fmt.Sprintf("New container passed its readiness check after %ds: Traefik now routes to it, removing the previous one.", seconds)
}
