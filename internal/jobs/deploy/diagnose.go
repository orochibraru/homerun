package deploy

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/zedensix/homerun/internal/dockerapi"
)

// FailedOutputTail is how many of a failed workload's last lines a diagnosis
// reads.
const FailedOutputTail = 40

// ExitCodeHint says in plain words what a container's exit code usually
// means, or "" for a code with no well-known meaning.
func ExitCodeHint(code int, oomKilled bool) string {
	switch {
	case oomKilled:
		return "killed for using more memory than its limit allows"
	case code == 0:
		return "it exited cleanly, but a service's process has to keep running"
	case code == 1:
		return "the app reported an error and quit"
	case code == 2:
		return "usually a bad command-line argument or a shell syntax error"
	case code == 125:
		return "the container runtime couldn't start it"
	case code == 126:
		return "its command exists but isn't executable"
	case code == 127:
		return "its command wasn't found in the image"
	case code == 137:
		return "killed by SIGKILL, most often for running out of memory"
	case code == 139:
		return "it crashed with a segmentation fault"
	case code == 143:
		return "it was stopped with SIGTERM"
	case code > 128 && code < 160:
		return fmt.Sprintf("killed by signal %d", code-128)
	}
	return ""
}

var logPatterns = []struct {
	hint    string
	needles []string
}{
	{"The image was built for another CPU architecture than the node it ran on.", []string{"exec format error"}},
	{"The container's command isn't in the image: check the command and entrypoint overrides.", []string{"executable file not found", "exec: not found", ": not found\n", "command not found"}},
	{"It ran out of memory: raise its memory limit.", []string{"out of memory", "cannot allocate memory", "oomkilled"}},
	{"Something was denied permission, often a volume owned by another user than the one the image runs as.", []string{"permission denied", "eacces", "operation not permitted"}},
	{"Its port was already taken: check the port and the command's listen address.", []string{"address already in use", "eaddrinuse"}},
	{"It couldn't reach a dependency (a database, another service): check the host and URL environment variables, and that the dependency is running.", []string{"connection refused", "econnrefused", "no such host", "name or service not known", "enotfound", "could not connect", "connection timed out"}},
	{"A file or directory it expects is missing: a volume that isn't mounted, or a wrong path in an environment variable.", []string{"no such file or directory", "enoent"}},
	{"A required setting looks unset: check its environment variables.", []string{"is not set", "is required", "must be set", "missing required", "environment variable"}},
}

// LogHints scans a failed workload's output for well-known causes and returns
// one plain-words hint per cause found, in a fixed order.
func LogHints(output string) []string {
	text := strings.ToLower(output) + "\n"
	var hints []string
	for _, pattern := range logPatterns {
		for _, needle := range pattern.needles {
			if strings.Contains(text, needle) {
				hints = append(hints, pattern.hint)
				break
			}
		}
	}
	return hints
}

// Diagnosis is why a workload stopped as far as Docker tells: its last exit
// code, what that code usually means ("" while it never exited), its last
// output and a hint per well-known cause found in that output. The app's
// revision health watch and update trials report it the way a failed deploy
// does.
type Diagnosis struct {
	Causes    []string `json:"causes"`
	ExitCode  int      `json:"exitCode"`
	Meaning   string   `json:"meaning"`
	OOMKilled bool     `json:"oomKilled"`
	Output    string   `json:"output"`
}

// NewDiagnosis builds a diagnosis from an exit and the output read with it.
// exited is false for a workload still on its first run, whose exit code
// means nothing yet.
func NewDiagnosis(exited bool, exitCode int, oomKilled bool, output string) Diagnosis {
	output = strings.TrimSpace(strings.ReplaceAll(output, "\r", ""))
	causes := LogHints(output)
	if causes == nil {
		causes = []string{}
	}
	diagnosis := Diagnosis{Causes: causes, Output: output}
	if exited {
		diagnosis.ExitCode = exitCode
		diagnosis.OOMKilled = oomKilled
		diagnosis.Meaning = ExitCodeHint(exitCode, oomKilled)
	}
	return diagnosis
}

// LatestFailedTask is the most recently updated task that reported an error
// (a crash, a failed healthcheck, a rejected start), or false when none did.
func LatestFailedTask(tasks []dockerapi.SwarmTask) (dockerapi.SwarmTask, bool) {
	var latest time.Time
	var found dockerapi.SwarmTask
	ok := false
	for _, task := range tasks {
		if task.Status.Err == "" {
			continue
		}
		at, _ := time.Parse(time.RFC3339Nano, task.Status.Timestamp)
		if !ok || !at.Before(latest) {
			latest = at
			found = task
			ok = true
		}
	}
	return found, ok
}

// TaskFailure is a failed swarm task's error, followed by what its exit code
// usually means when the task's container ran at all.
func TaskFailure(task dockerapi.SwarmTask) string {
	message := task.Status.Err
	status := task.Status.ContainerStatus
	if status == nil || status.ContainerID == "" {
		return message
	}
	if hint := ExitCodeHint(status.ExitCode, false); hint != "" {
		return message + "; " + hint
	}
	return message
}

// reportOutput writes a failed workload's last output to the deploy log under
// header, followed by a hint for every well-known cause found in it.
func (r *run) reportOutput(header, output string) {
	output = strings.TrimSpace(strings.ReplaceAll(output, "\r", ""))
	if output == "" {
		r.progress.line(header + " (none)")
		return
	}
	r.progress.line(header)
	for _, line := range strings.Split(output, "\n") {
		if line != "" {
			r.progress.line("  " + line)
		}
	}
	for _, hint := range LogHints(output) {
		r.progress.line("Likely cause: " + hint)
	}
}

// reportTaskOutput writes the last output of a failed swarm task to the
// deploy log. A task rejected before its container started has none, so it
// writes nothing.
func (r *run) reportTaskOutput(ctx context.Context, task dockerapi.SwarmTask) {
	if task.Status.ContainerStatus == nil || task.Status.ContainerStatus.ContainerID == "" {
		return
	}
	output, err := r.docker.SwarmTaskLogsTail(ctx, task.ID, FailedOutputTail)
	if err != nil {
		r.progress.line(fmt.Sprintf("Couldn't read the failed task's output: %s", err))
		return
	}
	r.progress.line(fmt.Sprintf("Failed task %s exited with code %d.", shortTaskID(task.ID), task.Status.ContainerStatus.ExitCode))
	r.reportOutput("Its last output:", output)
}

// shortTaskID is a task id cut to the 12 characters the docker CLI shows.
func shortTaskID(id string) string {
	if len(id) > 12 {
		return id[:12]
	}
	return id
}
