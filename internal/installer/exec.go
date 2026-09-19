package installer

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// HomeRoot is where user home directories live. A variable, not a constant, so
// tests can point the whole installer at a scratch directory.
var HomeRoot = "/home"

// HomeOf is the install user's home directory.
func HomeOf(username string) string {
	return filepath.Join(HomeRoot, username)
}

// Result is one command's exit code and captured output.
type Result struct {
	Code   int
	Stderr string
	Stdout string
}

// Opts are the per-command execution options: run as another user, from a
// working directory, with extra environment variables.
type Opts struct {
	As  string
	Cwd string
	Env map[string]string
}

// Runner is every shell-out and file write this installer performs, behind one
// interface so --dry-run has exactly one place to intercept and so the steps
// can be tested without a Linux box.
type Runner interface {
	Run(cmd []string, opts Opts) (Result, error)
	RunOK(cmd []string, opts Opts) bool
	WriteFile(path, content string) error
	AppendLine(path, line string) error
}

// StepRunner is the real Runner: it actually spawns processes and writes files,
// unless dryRun is set, in which case it only logs what it would have done.
type StepRunner struct {
	dryRun bool
}

// NewStepRunner builds the real runner. With dryRun, every command is logged
// and nothing is executed or written.
func NewStepRunner(dryRun bool) *StepRunner {
	return &StepRunner{dryRun: dryRun}
}

// EnvPrefix threads environment variables through sudo explicitly. sudo resets
// the environment by default (env_reset), so passing them to the child process
// wouldn't survive it: when running as another user they go through an explicit
// `env K=V ...` prefix inside the sudo'd command instead.
func EnvPrefix(env map[string]string) []string {
	if len(env) == 0 {
		return nil
	}
	prefix := []string{"env"}
	for _, key := range SortedKeys(env) {
		prefix = append(prefix, fmt.Sprintf("%s=%s", key, env[key]))
	}
	return prefix
}

// FullCommand is the argv actually executed, wrapped in sudo when opts.As is set.
func FullCommand(cmd []string, opts Opts) []string {
	if opts.As == "" {
		return cmd
	}
	full := []string{"sudo", "-u", opts.As, "--"}
	full = append(full, EnvPrefix(opts.Env)...)
	return append(full, cmd...)
}

// Run runs cmd and returns an error on a non-zero exit: the default for steps
// where "continue anyway" would leave the system half-configured.
func (r *StepRunner) Run(cmd []string, opts Opts) (Result, error) {
	full := FullCommand(cmd, opts)
	r.log(full, opts)
	if r.dryRun {
		return Result{}, nil
	}

	command := exec.Command(full[0], full[1:]...)
	command.Dir = opts.Cwd
	command.Env = os.Environ()
	for _, key := range SortedKeys(opts.Env) {
		command.Env = append(command.Env, fmt.Sprintf("%s=%s", key, opts.Env[key]))
	}
	var stdout, stderr strings.Builder
	command.Stdout = &stdout
	command.Stderr = &stderr
	err := command.Run()

	result := Result{Stdout: stdout.String(), Stderr: stderr.String()}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		result.Code = exitErr.ExitCode()
	}
	if strings.TrimSpace(result.Stdout) != "" {
		fmt.Fprint(os.Stdout, result.Stdout)
	}
	if strings.TrimSpace(result.Stderr) != "" {
		fmt.Fprint(os.Stderr, result.Stderr)
	}
	if err != nil {
		return result, fmt.Errorf("command failed (%d): %s", result.Code, strings.Join(full, " "))
	}
	return result, nil
}

// RunOK is like Run, but a failure is reported and swallowed rather than
// returned: for idempotency checks ("does this user already exist?") where
// failure just means "not yet, keep going".
func (r *StepRunner) RunOK(cmd []string, opts Opts) bool {
	_, err := r.Run(cmd, opts)
	return err == nil
}

// WriteFile writes a file's content directly (systemd units, etc.). A no-op
// under --dry-run, just logged like everything else.
func (r *StepRunner) WriteFile(path, content string) error {
	prefix := "[write]"
	if r.dryRun {
		prefix = "[dry-run]"
	}
	fmt.Printf("%s %s (%d bytes)\n", prefix, path, len(content))
	if r.dryRun {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0o644)
}

// AppendLine appends one line to a file, creating it if it doesn't exist yet:
// used for secrets that must not be clobbered once generated (see
// ensureAuthSecret). A no-op under --dry-run.
func (r *StepRunner) AppendLine(path, line string) error {
	prefix := "[append]"
	if r.dryRun {
		prefix = "[dry-run]"
	}
	fmt.Printf("%s %s += 1 line\n", prefix, path)
	if r.dryRun {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	existing, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	separator := ""
	if len(existing) > 0 && !strings.HasSuffix(string(existing), "\n") {
		separator = "\n"
	}
	return os.WriteFile(path, []byte(string(existing)+separator+line+"\n"), 0o644)
}

// log echoes the command about to run, prefixed [dry-run] or [run], with its
// working directory when one is set.
func (r *StepRunner) log(cmd []string, opts Opts) {
	prefix := "[run]"
	if r.dryRun {
		prefix = "[dry-run]"
	}
	cwd := ""
	if opts.Cwd != "" {
		cwd = fmt.Sprintf(" (cwd=%s)", opts.Cwd)
	}
	fmt.Printf("%s %s%s\n", prefix, strings.Join(cmd, " "), cwd)
}

// SortedKeys keeps generated argv and environment ordering deterministic, since
// Go map iteration is deliberately randomized.
func SortedKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	for i := 1; i < len(keys); i++ {
		for j := i; j > 0 && keys[j] < keys[j-1]; j-- {
			keys[j], keys[j-1] = keys[j-1], keys[j]
		}
	}
	return keys
}

// CommandExists reports whether cmd resolves on PATH. Runs for real even under
// --dry-run, since it only reads.
var CommandExists = func(cmd string) bool {
	_, err := exec.LookPath(cmd)
	return err == nil
}

// FileExists reports whether path exists, of any kind.
func FileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}
