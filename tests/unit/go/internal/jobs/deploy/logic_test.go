package deploy_test

import (
	"reflect"
	"strings"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
	"github.com/orochibraru/homerun/internal/jobs/deploy"
	"github.com/orochibraru/homerun/internal/jobs/imagescan"
)

func TestReadinessCheck(t *testing.T) {
	routed := deploy.ReadinessInput{ContainerPort: 8080, Routed: true}
	shell := &deploy.ImageFacts{HasShell: true}
	cases := []struct {
		name  string
		in    deploy.ReadinessInput
		image *deploy.ImageFacts
		want  deploy.Readiness
	}{
		{"the service's command wins", deploy.ReadinessInput{HealthcheckCommand: "true"}, nil, deploy.Readiness{Kind: "service-healthcheck"}},
		{"nothing to gate without a route", deploy.ReadinessInput{ContainerPort: 80}, shell, deploy.Readiness{Kind: "none", Reason: "not-routed"}},
		{"the image's own healthcheck", routed, &deploy.ImageFacts{HasHealthcheck: true}, deploy.Readiness{Kind: "image-healthcheck"}},
		{"a routed TCP port listens", routed, shell, deploy.Readiness{Kind: "listening"}},
		{"udp only", deploy.ReadinessInput{ContainerPort: 80, PortProtocol: "udp", Routed: true}, shell, deploy.Readiness{Kind: "none", Reason: "udp-only"}},
		{"no shell", routed, &deploy.ImageFacts{}, deploy.Readiness{Kind: "none", Reason: "no-shell"}},
		{"image unknown", routed, nil, deploy.Readiness{Kind: "none", Reason: "image-unknown"}},
	}
	for _, c := range cases {
		if got := deploy.ReadinessCheck(c.in, c.image); got != c.want {
			t.Errorf("%s: got %+v, want %+v", c.name, got, c.want)
		}
	}
	if !routed.NeedsImage() || (deploy.ReadinessInput{HealthcheckCommand: "x", Routed: true}).NeedsImage() ||
		(deploy.ReadinessInput{PortProtocol: "udp", Routed: true}).NeedsImage() {
		t.Error("only a routed TCP service without a command needs the image")
	}
	if deploy.ImageDeclaresHealthcheck(nil) || deploy.ImageDeclaresHealthcheck([]string{"NONE"}) || !deploy.ImageDeclaresHealthcheck([]string{"CMD-SHELL", "true"}) {
		t.Error("NONE and an empty test don't count")
	}
	if got := deploy.ReadinessDescription(deploy.Readiness{Kind: "listening"}, 3000, "task"); !strings.Contains(got, "port 3000 to be listening") {
		t.Errorf("listening description: %q", got)
	}
	if got := deploy.ReadinessDescription(deploy.Readiness{Kind: "none", Reason: "no-shell"}, 80, "container"); !strings.Contains(got, "no /bin/sh") {
		t.Errorf("no-shell description: %q", got)
	}
	if !reflect.DeepEqual(deploy.ReadinessLabels(deploy.Readiness{Kind: "listening"}), map[string]string{deploy.ReadinessLabel: "listening"}) ||
		len(deploy.ReadinessLabels(deploy.Readiness{Kind: "image-healthcheck"})) != 0 {
		t.Error("only the listening check is labelled")
	}
}

func TestReadinessVerdict(t *testing.T) {
	settle, maxWait := 5*time.Second, time.Minute
	running := deploy.Sample{Health: "none", State: "running"}
	if got := deploy.ReadinessVerdict(deploy.Sample{Health: "healthy", State: "running"}, time.Second, settle, maxWait); got.State != "ready" {
		t.Errorf("healthy is ready at once, got %+v", got)
	}
	if deploy.ReadinessVerdict(running, time.Second, settle, maxWait).State != "pending" ||
		deploy.ReadinessVerdict(running, 5*time.Second, settle, maxWait).State != "ready" {
		t.Error("without a healthcheck it waits for the settle period")
	}
	starting := deploy.Sample{Health: "starting", State: "running"}
	if deploy.ReadinessVerdict(starting, 30*time.Second, settle, maxWait).State != "pending" ||
		deploy.ReadinessVerdict(starting, time.Minute, settle, maxWait).State != "failed" {
		t.Error("a starting healthcheck stays pending until the max wait")
	}
	one := 1
	if got := deploy.ReadinessVerdict(deploy.Sample{ExitCode: &one, Health: "none", State: "exited"}, 0, settle, maxWait); got.Reason != "The new container exited with code 1." {
		t.Errorf("exit: %+v", got)
	}
	if deploy.ReadinessVerdict(deploy.Sample{Health: "none", RestartCount: 1, State: "running"}, 0, settle, maxWait).State != "failed" ||
		deploy.ReadinessVerdict(deploy.SampleFromInspect(nil), 0, settle, maxWait).State != "failed" {
		t.Error("restarts and disappearance fail at once")
	}
	if got := deploy.ReadinessVerdict(deploy.Sample{Health: "unhealthy", HealthOutput: "connection refused", State: "running"}, 0, settle, maxWait); got.Reason != "The new container's healthcheck failed: connection refused" {
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
	got := deploy.SampleFromInspect(&info)
	if got.Health != "healthy" || got.HealthOutput != "ok" || got.RestartCount != 2 || got.State != "running" {
		t.Errorf("got %+v", got)
	}
	if deploy.SampleFromInspect(nil).State != "missing" {
		t.Error("a gone container is missing")
	}
}

func TestRolloutStrategy(t *testing.T) {
	if !deploy.RolloutStrategy(true, false, false, []deploy.Volume{{ReadOnly: true}}).BlueGreen {
		t.Error("a running previous container on bridge networking rolls out blue-green")
	}
	if got := deploy.RolloutStrategy(false, false, false, nil); got.BlueGreen || got.Reason != "" {
		t.Errorf("nothing running is a plain recreate, got %+v", got)
	}
	if got := deploy.RolloutStrategy(true, true, false, nil); !strings.Contains(got.Reason, "Host networking") {
		t.Errorf("host: %+v", got)
	}
	if got := deploy.RolloutStrategy(true, false, true, nil); !strings.Contains(got.Reason, "published host port") {
		t.Errorf("published port: %+v", got)
	}
	if got := deploy.RolloutStrategy(true, false, false, []deploy.Volume{{}}); !strings.Contains(got.Reason, "writable volume") {
		t.Errorf("volume: %+v", got)
	}
	if deploy.SwarmUpdateOrder([]deploy.Volume{{ReadOnly: true}}) != "start-first" || deploy.SwarmUpdateOrder([]deploy.Volume{{}}) != "stop-first" {
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
	if deploy.SwarmUpdateOutcome(status("completed", "t1", ""), "t1").State != "pending" {
		t.Error("ignores the update status left by an earlier deploy")
	}
	if deploy.SwarmUpdateOutcome(&dockerapi.SwarmService{}, "").State != "pending" {
		t.Error("no status yet is pending")
	}
	if deploy.SwarmUpdateOutcome(status("completed", "t2", ""), "t1").State != "completed" {
		t.Error("reports completion")
	}
	failed := deploy.SwarmUpdateOutcome(status("rollback_completed", "t2", "update rolled back due to failure"), "")
	if failed.State != "failed" || !strings.Contains(failed.Reason, "update rolled back due to failure") {
		t.Errorf("a rollback is a failure, got %+v", failed)
	}
	paused := deploy.SwarmUpdateOutcome(status("paused", "t2", "update paused due to failure"), "")
	if paused.State != "failed" || !strings.Contains(paused.Reason, "left the new ones in place") {
		t.Errorf("a pause is a failure that keeps the new tasks, got %+v", paused)
	}
}

func swarmTask(desired, state, err, at string) dockerapi.SwarmTask {
	task := dockerapi.SwarmTask{DesiredState: desired}
	task.Status.State = state
	task.Status.Err = err
	task.Status.Timestamp = at
	return task
}

func TestSwarmFailureAction(t *testing.T) {
	if deploy.SwarmFailureAction([]dockerapi.SwarmTask{swarmTask("running", "running", "", "")}) != "rollback" {
		t.Error("a running current task is worth rolling back to")
	}
	crashing := []dockerapi.SwarmTask{
		swarmTask("running", "starting", "", ""),
		swarmTask("shutdown", "failed", "task: non-zero exit (1)", ""),
	}
	if deploy.SwarmFailureAction(crashing) != "pause" {
		t.Error("tasks that aren't running aren't worth rolling back to")
	}
	if deploy.SwarmFailureAction(nil) != "pause" {
		t.Error("no current task at all pauses")
	}
}

func TestLastTaskError(t *testing.T) {
	tasks := []dockerapi.SwarmTask{
		swarmTask("shutdown", "failed", "old failure", "2026-09-25T11:00:00Z"),
		swarmTask("running", "running", "", "2026-09-25T12:00:00Z"),
		swarmTask("shutdown", "failed", "task: non-zero exit (1): invalid DATABASE_URL", "2026-09-25T11:00:00.5Z"),
	}
	if got := deploy.LastTaskError(tasks); got != "task: non-zero exit (1): invalid DATABASE_URL" {
		t.Errorf("the newest task error wins, got %q", got)
	}
	if deploy.LastTaskError(nil) != "" {
		t.Error("no tasks, no error")
	}
}

func TestShouldSkipPull(t *testing.T) {
	if deploy.ShouldSkipPull("always", true) != "" || deploy.ShouldSkipPull("missing", false) != "" {
		t.Error("always pulls, and missing pulls when absent")
	}
	if !strings.Contains(deploy.ShouldSkipPull("missing", true), "If missing") || !strings.Contains(deploy.ShouldSkipPull("never", false), "isn't on this host") {
		t.Error("skip lines")
	}
}

func TestEnvMerging(t *testing.T) {
	parsed := deploy.ParseDotEnv("# comment\n\nexport A=1\nB=\"two\"\r\nnot valid\n1X=3\nC='x=y'\nA=override\n")
	merged := [][2]string{}
	for _, pair := range parsed {
		merged = deploy.SetEnv(merged, pair[0], pair[1])
	}
	merged = deploy.SetEnv(merged, "B", "service")
	merged = deploy.SetEnv(merged, "D", "new")
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
	if deploy.BlockReason(summary, deploy.BlockPolicy{}) != "" {
		t.Error("no severity never blocks")
	}
	got := deploy.BlockReason(summary, deploy.BlockPolicy{Severity: "HIGH"})
	if !strings.HasPrefix(got, "Blocked by the image scan policy (block at HIGH or above): 3 vulnerabilities at or above the threshold (1 critical, 2 high).") {
		t.Errorf("got %q", got)
	}
	got = deploy.BlockReason(summary, deploy.BlockPolicy{FixableOnly: true, Severity: "CRITICAL"})
	if got != "" {
		t.Errorf("no fixable critical findings don't block, got %q", got)
	}
	got = deploy.BlockReason(summary, deploy.BlockPolicy{FixableOnly: true, Severity: "LOW"})
	if !strings.Contains(got, "(block at LOW or above, fixable only): 1 fixable vulnerability") {
		t.Errorf("got %q", got)
	}
}

func TestDescribeRevision(t *testing.T) {
	got := deploy.DescribeRevision(deploy.Revision{
		Digest:    "sha256:0123456789abcdef0123",
		GitCommit: "abcdef0123456789",
		GitRef:    "main",
		ImageRef:  "homerun-build-api:abc",
	})
	if got != "homerun-build-api:abc sha256:0123456789ab (main@abcdef0)" {
		t.Errorf("got %q", got)
	}
}
