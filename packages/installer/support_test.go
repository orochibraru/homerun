package main

import (
	"os"
	"strings"
	"testing"
)

// fakeRunner records everything a step would have done, and can be told to fail
// or to answer a given command with canned stdout.
type fakeRunner struct {
	appends  map[string][]string
	calls    []fakeCall
	failures map[string]bool
	stdout   map[string]string
	writes   map[string]string
}

// fakeCall is one recorded command and the options it ran with.
type fakeCall struct {
	Cmd  []string
	Opts Opts
}

func newFakeRunner() *fakeRunner {
	return &fakeRunner{
		appends:  map[string][]string{},
		failures: map[string]bool{},
		stdout:   map[string]string{},
		writes:   map[string]string{},
	}
}

// fails makes any command whose joined form contains substr return an error.
func (f *fakeRunner) fails(substr string) *fakeRunner {
	f.failures[substr] = true
	return f
}

// answers makes any command whose joined form contains substr return stdout.
func (f *fakeRunner) answers(substr, stdout string) *fakeRunner {
	f.stdout[substr] = stdout
	return f
}

func (f *fakeRunner) Run(cmd []string, opts Opts) (Result, error) {
	f.calls = append(f.calls, fakeCall{Cmd: cmd, Opts: opts})
	joined := strings.Join(cmd, " ")
	for substr := range f.failures {
		if strings.Contains(joined, substr) {
			return Result{Code: 1}, &commandError{command: joined}
		}
	}
	for substr, out := range f.stdout {
		if strings.Contains(joined, substr) {
			return Result{Stdout: out}, nil
		}
	}
	return Result{}, nil
}

func (f *fakeRunner) RunOK(cmd []string, opts Opts) bool {
	_, err := f.Run(cmd, opts)
	return err == nil
}

func (f *fakeRunner) WriteFile(path, content string) error {
	f.writes[path] = content
	return nil
}

func (f *fakeRunner) AppendLine(path, line string) error {
	f.appends[path] = append(f.appends[path], line)
	return nil
}

// commandError is the failure a faked command returns.
type commandError struct{ command string }

func (e *commandError) Error() string { return "command failed: " + e.command }

// commands is every recorded command, joined, for readable assertions.
func (f *fakeRunner) commands() []string {
	joined := make([]string, 0, len(f.calls))
	for _, call := range f.calls {
		joined = append(joined, strings.Join(call.Cmd, " "))
	}
	return joined
}

// ran reports whether any recorded command contains substr.
func (f *fakeRunner) ran(substr string) bool {
	for _, command := range f.commands() {
		if strings.Contains(command, substr) {
			return true
		}
	}
	return false
}

// callFor returns the first recorded call containing substr.
func (f *fakeRunner) callFor(t *testing.T, substr string) fakeCall {
	t.Helper()
	for _, call := range f.calls {
		if strings.Contains(strings.Join(call.Cmd, " "), substr) {
			return call
		}
	}
	t.Fatalf("no command matching %q in %v", substr, f.commands())
	return fakeCall{}
}

// withHomeRoot points the installer's home directories at a scratch tree for
// one test, and creates the install user's home.
func withHomeRoot(t *testing.T, username string) string {
	t.Helper()
	root := t.TempDir()
	original := homeRoot
	homeRoot = root
	t.Cleanup(func() { homeRoot = original })
	if err := os.MkdirAll(root+"/"+username+"/homerun", 0o755); err != nil {
		t.Fatal(err)
	}
	return root + "/" + username
}

// stubCommandExists makes commandExists answer from a fixed set for one test.
func stubCommandExists(t *testing.T, present ...string) {
	t.Helper()
	original := commandExists
	commandExists = func(cmd string) bool {
		for _, candidate := range present {
			if candidate == cmd {
				return true
			}
		}
		return false
	}
	t.Cleanup(func() { commandExists = original })
}

// stubCommandOutput makes commandOutput answer from a map keyed by the joined
// command, for one test.
func stubCommandOutput(t *testing.T, answers map[string]string) {
	t.Helper()
	original := commandOutput
	commandOutput = func(cmd []string) string { return answers[strings.Join(cmd, " ")] }
	t.Cleanup(func() { commandOutput = original })
}

// captureStdout runs fn with stdout redirected and returns what it printed.
func captureStdout(t *testing.T, fn func()) string {
	t.Helper()
	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = write
	done := make(chan string)
	go func() {
		var builder strings.Builder
		buffer := make([]byte, 4096)
		for {
			n, err := read.Read(buffer)
			builder.Write(buffer[:n])
			if err != nil {
				break
			}
		}
		done <- builder.String()
	}()
	fn()
	write.Close()
	os.Stdout = original
	return <-done
}
