package deploy

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs/imagescan"
)

func TestReadinessCheck(t *testing.T) {
	routed := ReadinessInput{ContainerPort: 8080, Routed: true}
	shell := &imageFacts{hasShell: true}
	cases := []struct {
		name  string
		in    ReadinessInput
		image *imageFacts
		want  readiness
	}{
		{"the service's command wins", ReadinessInput{HealthcheckCommand: "true"}, nil, readiness{kind: "service-healthcheck"}},
		{"nothing to gate without a route", ReadinessInput{ContainerPort: 80}, shell, readiness{kind: "none", reason: "not-routed"}},
		{"the image's own healthcheck", routed, &imageFacts{hasHealthcheck: true}, readiness{kind: "image-healthcheck"}},
		{"a routed TCP port listens", routed, shell, readiness{kind: "listening"}},
		{"udp only", ReadinessInput{ContainerPort: 80, PortProtocol: "udp", Routed: true}, shell, readiness{kind: "none", reason: "udp-only"}},
		{"no shell", routed, &imageFacts{}, readiness{kind: "none", reason: "no-shell"}},
		{"image unknown", routed, nil, readiness{kind: "none", reason: "image-unknown"}},
	}
	for _, c := range cases {
		if got := readinessCheck(c.in, c.image); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
	if !routed.needsImage() || (ReadinessInput{HealthcheckCommand: "x", Routed: true}).needsImage() ||
		(ReadinessInput{PortProtocol: "udp", Routed: true}).needsImage() {
		t.Error("only a routed TCP service without a command needs the image")
	}
	if imageDeclaresHealthcheck(nil) || imageDeclaresHealthcheck([]string{"NONE"}) || !imageDeclaresHealthcheck([]string{"CMD-SHELL", "true"}) {
		t.Error("NONE and an empty test don't count")
	}
	if got := readinessDescription(readiness{kind: "listening"}, 3000, "task"); !strings.Contains(got, "port 3000 to be listening") {
		t.Errorf("listening description: %q", got)
	}
	if got := readinessDescription(readiness{kind: "none", reason: "no-shell"}, 80, "container"); !strings.Contains(got, "no /bin/sh") {
		t.Errorf("no-shell description: %q", got)
	}
	if !reflect.DeepEqual(readinessLabels(readiness{kind: "listening"}), map[string]string{readinessLabel: "listening"}) ||
		len(readinessLabels(readiness{kind: "image-healthcheck"})) != 0 {
		t.Error("only the listening check is labelled")
	}
}

func TestReadinessVerdict(t *testing.T) {
	settle, maxWait := 5*time.Second, time.Minute
	running := sample{health: "none", state: "running"}
	if got := readinessVerdict(sample{health: "healthy", state: "running"}, time.Second, settle, maxWait); got.state != "ready" {
		t.Errorf("healthy is ready at once, got %+v", got)
	}
	if readinessVerdict(running, time.Second, settle, maxWait).state != "pending" ||
		readinessVerdict(running, 5*time.Second, settle, maxWait).state != "ready" {
		t.Error("without a healthcheck it waits for the settle period")
	}
	starting := sample{health: "starting", state: "running"}
	if readinessVerdict(starting, 30*time.Second, settle, maxWait).state != "pending" ||
		readinessVerdict(starting, time.Minute, settle, maxWait).state != "failed" {
		t.Error("a starting healthcheck stays pending until the max wait")
	}
	one := 1
	if got := readinessVerdict(sample{exitCode: &one, health: "none", state: "exited"}, 0, settle, maxWait); got.reason != "The new container exited with code 1." {
		t.Errorf("exit: %+v", got)
	}
	if readinessVerdict(sample{health: "none", restartCount: 1, state: "running"}, 0, settle, maxWait).state != "failed" ||
		readinessVerdict(sampleFromInspect(nil), 0, settle, maxWait).state != "failed" {
		t.Error("restarts and disappearance fail at once")
	}
	if got := readinessVerdict(sample{health: "unhealthy", healthOutput: "connection refused", state: "running"}, 0, settle, maxWait); got.reason != "The new container's healthcheck failed: connection refused" {
		t.Errorf("unhealthy: %+v", got)
	}
}

func TestSampleFromInspect(t *testing.T) {
	var info dockerapi.ContainerInspect
	info.RestartCount = 2
	info.State.Status = "running"
	info.State.Health = &struct {
		Log []struct {
			Output string `json:"Output"`
		} `json:"Log"`
		Status string `json:"Status"`
	}{Log: []struct {
		Output string `json:"Output"`
	}{{Output: " ok \n"}}, Status: "healthy"}
	got := sampleFromInspect(&info)
	if got.health != "healthy" || got.healthOutput != "ok" || got.restartCount != 2 || got.state != "running" {
		t.Errorf("got %+v", got)
	}
	if sampleFromInspect(nil).state != "missing" {
		t.Error("a gone container is missing")
	}
}

func TestRolloutStrategy(t *testing.T) {
	if !rolloutStrategy(true, false, []Volume{{ReadOnly: true}}).blueGreen {
		t.Error("a running previous container on bridge networking rolls out blue-green")
	}
	if got := rolloutStrategy(false, false, nil); got.blueGreen || got.reason != "" {
		t.Errorf("nothing running is a plain recreate, got %+v", got)
	}
	if got := rolloutStrategy(true, true, nil); !strings.Contains(got.reason, "Host networking") {
		t.Errorf("host: %+v", got)
	}
	if got := rolloutStrategy(true, false, []Volume{{}}); !strings.Contains(got.reason, "writable volume") {
		t.Errorf("volume: %+v", got)
	}
	if swarmUpdateOrder([]Volume{{ReadOnly: true}}) != "start-first" || swarmUpdateOrder([]Volume{{}}) != "stop-first" {
		t.Error("start-first unless a mount is writable")
	}
}

func TestSwarmUpdateOutcome(t *testing.T) {
	status := func(state, started, message string) *dockerapi.SwarmService {
		service := &dockerapi.SwarmService{}
		service.UpdateStatus = &struct {
			Message   string `json:"Message"`
			StartedAt string `json:"StartedAt"`
			State     string `json:"State"`
		}{Message: message, StartedAt: started, State: state}
		return service
	}
	if swarmUpdateOutcome(status("completed", "t1", ""), "t1").state != "pending" {
		t.Error("ignores the update status left by an earlier deploy")
	}
	if swarmUpdateOutcome(&dockerapi.SwarmService{}, "").state != "pending" {
		t.Error("no status yet is pending")
	}
	if swarmUpdateOutcome(status("completed", "t2", ""), "t1").state != "completed" {
		t.Error("reports completion")
	}
	failed := swarmUpdateOutcome(status("rollback_completed", "t2", "update rolled back due to failure"), "")
	if failed.state != "failed" || !strings.Contains(failed.reason, "update rolled back due to failure") {
		t.Errorf("a rollback is a failure, got %+v", failed)
	}
}

func TestShouldSkipPull(t *testing.T) {
	if shouldSkipPull("always", true) != "" || shouldSkipPull("missing", false) != "" {
		t.Error("always pulls, and missing pulls when absent")
	}
	if !strings.Contains(shouldSkipPull("missing", true), "If missing") || !strings.Contains(shouldSkipPull("never", false), "isn't on this host") {
		t.Error("skip lines")
	}
}

func TestEnvMerging(t *testing.T) {
	parsed := parseDotEnv("# comment\n\nexport A=1\nB=\"two\"\r\nnot valid\n1X=3\nC='x=y'\nA=override\n")
	merged := [][2]string{}
	for _, pair := range parsed {
		merged = setEnv(merged, pair[0], pair[1])
	}
	merged = setEnv(merged, "B", "service")
	merged = setEnv(merged, "D", "new")
	want := [][2]string{{"A", "override"}, {"B", "service"}, {"C", "x=y"}, {"D", "new"}}
	if !reflect.DeepEqual(merged, want) {
		t.Errorf("got %v, want %v", merged, want)
	}
}

func TestBlockReason(t *testing.T) {
	summary := imagescan.Summary{
		Counts:        imagescan.Counts{Critical: 1, High: 2, Medium: 3},
		FixableCounts: imagescan.Counts{High: 1},
	}
	if blockReason(summary, BlockPolicy{}) != "" {
		t.Error("no severity never blocks")
	}
	got := blockReason(summary, BlockPolicy{Severity: "HIGH"})
	if !strings.HasPrefix(got, "Blocked by the image scan policy (block at HIGH or above): 3 vulnerabilities at or above the threshold (1 critical, 2 high).") {
		t.Errorf("got %q", got)
	}
	got = blockReason(summary, BlockPolicy{FixableOnly: true, Severity: "CRITICAL"})
	if got != "" {
		t.Errorf("no fixable critical findings don't block, got %q", got)
	}
	got = blockReason(summary, BlockPolicy{FixableOnly: true, Severity: "LOW"})
	if !strings.Contains(got, "(block at LOW or above, fixable only): 1 fixable vulnerability") {
		t.Errorf("got %q", got)
	}
}

func TestDescribeRevision(t *testing.T) {
	got := describeRevision(Revision{
		Digest:    "sha256:0123456789abcdef0123",
		GitCommit: "abcdef0123456789",
		GitRef:    "main",
		ImageRef:  "homerun-build-api:abc",
	})
	if got != "homerun-build-api:abc sha256:0123456789ab (main@abcdef0)" {
		t.Errorf("got %q", got)
	}
}
