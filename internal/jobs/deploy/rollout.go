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

// Sample is a container's health as the rollout judges it.
type Sample struct {
	ExitCode     *int
	Health       string
	HealthOutput string
	RestartCount int
	State        string
}

// SampleFromInspect reads a Sample off a container inspect, or a "missing"
// sample when info is nil (the container is gone).
func SampleFromInspect(info *dockerapi.ContainerInspect) Sample {
	if info == nil {
		return Sample{Health: "none", State: "missing"}
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
	return Sample{ExitCode: &exitCode, Health: health, HealthOutput: output, RestartCount: info.RestartCount, State: status}
}

// Verdict is a rollout judgement: State is "pending", "ready", "completed" or
// "failed", with a human Reason for the latter.
type Verdict struct {
	Reason string
	State  string
}

// ReadinessVerdict judges a new workload's sample after elapsed: ready once
// healthy (or running for settle without a healthcheck), failed once it
// disappears, exits, restarts, turns unhealthy or outlives maxWait, pending
// otherwise.
func ReadinessVerdict(s Sample, elapsed, settle, maxWait time.Duration) Verdict {
	switch {
	case s.State == "missing":
		return Verdict{State: "failed", Reason: "The new container disappeared."}
	case s.State == "exited":
		code := "unknown"
		if s.ExitCode != nil {
			code = fmt.Sprint(*s.ExitCode)
		}
		return Verdict{State: "failed", Reason: fmt.Sprintf("The new container exited with code %s.", code)}
	case s.State == "restarting" || s.RestartCount > 0:
		return Verdict{State: "failed", Reason: "The new container keeps restarting."}
	case s.Health == "unhealthy":
		if s.HealthOutput != "" {
			return Verdict{State: "failed", Reason: "The new container's healthcheck failed: " + s.HealthOutput}
		}
		return Verdict{State: "failed", Reason: "The new container's healthcheck failed."}
	case s.Health == "healthy":
		return Verdict{State: "ready"}
	case s.Health == "none" && s.State == "running" && elapsed >= settle:
		return Verdict{State: "ready"}
	case elapsed >= maxWait:
		return Verdict{State: "failed", Reason: fmt.Sprintf("The new container wasn't ready after %ds.", int(maxWait.Seconds()))}
	}
	return Verdict{State: "pending"}
}

// RolloutPlan is whether a deploy can run the new container alongside the
// running previous one (blue-green) or must stop it first, with why not.
type RolloutPlan struct {
	BlueGreen bool
	Reason    string
}

// RolloutStrategy runs the new container alongside the running previous one,
// unless host networking or a writable volume forces a recreate.
func RolloutStrategy(hasRunningPrevious, hostNetwork bool, volumes []Volume) RolloutPlan {
	switch {
	case !hasRunningPrevious:
		return RolloutPlan{}
	case hostNetwork:
		return RolloutPlan{Reason: "Host networking can't run two copies side by side, so the previous container stops first."}
	case anyWritable(volumes):
		return RolloutPlan{Reason: "A writable volume can't safely be shared by two copies, so the previous container stops first."}
	}
	return RolloutPlan{BlueGreen: true}
}

// anyWritable reports whether any volume in volumes is not read-only.
func anyWritable(volumes []Volume) bool {
	for _, volume := range volumes {
		if !volume.ReadOnly {
			return true
		}
	}
	return false
}

// SwarmUpdateOrder is stop-first when a writable volume can't be shared by
// two tasks, start-first otherwise.
func SwarmUpdateOrder(volumes []Volume) string {
	if anyWritable(volumes) {
		return "stop-first"
	}
	return "start-first"
}

// SwarmUpdateOutcome reads a swarm service's update status: State is
// "pending", "completed" or "failed".
func SwarmUpdateOutcome(service *dockerapi.SwarmService, previousStartedAt string) Verdict {
	status := service.UpdateStatus
	if status == nil || status.State == "" || status.StartedAt == previousStartedAt {
		return Verdict{State: "pending"}
	}
	switch status.State {
	case "completed":
		return Verdict{State: "completed"}
	case "paused", "rollback_started", "rollback_paused", "rollback_completed":
		reason := "The new swarm tasks didn't become healthy, so swarm kept the previous ones"
		if status.Message != "" {
			return Verdict{State: "failed", Reason: reason + ": " + status.Message}
		}
		return Verdict{State: "failed", Reason: reason + "."}
	}
	return Verdict{State: "pending"}
}

// ReadyLine is the deploy log line for a new container that became ready.
func ReadyLine(check Readiness, seconds int) string {
	if check.Kind == "none" && check.Reason == "not-routed" {
		return fmt.Sprintf("New container kept running for %ds, removing the previous one.", seconds)
	}
	if check.Kind == "none" {
		return fmt.Sprintf("New container kept running for %ds, removing the previous one (Traefik was already sending it traffic).", seconds)
	}
	return fmt.Sprintf("New container passed its readiness check after %ds: Traefik now routes to it, removing the previous one.", seconds)
}
