package installer_test

import (
	"os"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/installer"
)

func TestNormalizeHostStripsAPastedURL(t *testing.T) {
	cases := map[string]string{
		"  homerun.example.com ":           "homerun.example.com",
		"https://homerun.example.com/":     "homerun.example.com",
		"http://homerun.example.com///":    "homerun.example.com",
		"https://homerun.example.com:3000": "homerun.example.com:3000",
		"":                                 "",
	}
	for input, want := range cases {
		if got := installer.NormalizeHost(input); got != want {
			t.Errorf("%q: want %q, got %q", input, want, got)
		}
	}
}

func TestResolveHost(t *testing.T) {
	stubTTY(t, false)

	if host, err := installer.ResolveHost(installer.Options{Domain: "https://homerun.example.com/"}); err != nil || host != "homerun.example.com" {
		t.Errorf("--domain= should win and be normalised, got %q %v", host, err)
	}

	stubCommandOutput(t, map[string]string{"hostname -I": "203.0.113.10\n"})
	host, err := installer.ResolveHost(installer.Options{})
	if err != nil || host != "203.0.113.10" {
		t.Errorf("a detected address should be used without a prompt, got %q %v", host, err)
	}

	stubCommandOutput(t, map[string]string{})
	if _, err := installer.ResolveHost(installer.Options{}); err == nil {
		t.Error("no domain and nothing detectable should fail loudly, not default to localhost")
	} else if !strings.Contains(err.Error(), "--domain=") {
		t.Errorf("the error should say how to fix it, got %q", err)
	}

	if host, err := installer.ResolveHost(installer.Options{DryRun: true}); err != nil || host != "203.0.113.10" {
		t.Errorf("--dry-run should still produce a plausible address, got %q %v", host, err)
	}
}

func TestAdvertiseAddressFor(t *testing.T) {
	stubCommandOutput(t, map[string]string{"hostname -I": "10.0.0.9\n"})
	if got := installer.AdvertiseAddressFor(installer.Options{AdvertiseAddress: "10.1.1.1"}); got != "10.1.1.1" {
		t.Errorf("the flag should win, got %q", got)
	}
	if got := installer.AdvertiseAddressFor(installer.Options{}); got != "10.0.0.9" {
		t.Errorf("otherwise the detected address, got %q", got)
	}

	stubCommandOutput(t, map[string]string{})
	if got := installer.AdvertiseAddressFor(installer.Options{}); got != "" {
		t.Errorf("nothing detectable lets docker swarm init pick, got %q", got)
	}
}

func TestPackageManagerForFallsBackUnderDryRun(t *testing.T) {
	stubCommandExists(t)

	if _, err := installer.PackageManagerFor(installer.Options{}); err == nil {
		t.Error("a real run on an unsupported distro should fail")
	}

	pm, err := installer.PackageManagerFor(installer.Options{DryRun: true})
	if err != nil {
		t.Fatalf("--dry-run should work off a real Debian/RHEL box: %v", err)
	}
	if pm.Kind != "apt" {
		t.Errorf("the dry-run fallback is apt, got %q", pm.Kind)
	}
}

func TestInstallStackAgent(t *testing.T) {
	withHomeRoot(t, "homerun")
	run := newFakeRunner()

	err := installer.InstallStack(
		installer.Options{AgentPort: 7420, Mode: installer.ModeAgent, RootlessUser: "homerun", Version: "latest"},
		run, installer.FlavourRootless, "/run/user/1000/docker.sock", "", "arm64",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !run.ran("homerun-worker-arm64.gz") {
		t.Error("an agent install should fetch the worker binary")
	}
	if run.ran("network create --driver overlay") {
		t.Error("a rootless install has no swarm overlay")
	}
	if run.ran("docker compose") {
		t.Error("an agent install brings up no stack")
	}
	network := run.callFor(t, "network inspect homerun")
	if network.Opts.As != "homerun" {
		t.Errorf("the rootless daemon is addressed as its user, got %q", network.Opts.As)
	}
}

func TestInstallStackFullRootful(t *testing.T) {
	withHomeRoot(t, "homerun")
	run := newFakeRunner().fails("network inspect")

	err := installer.InstallStack(
		installer.Options{Mode: installer.ModeFull, RootlessUser: "homerun", Version: "v1.2.3"},
		run, installer.FlavourRootful, installer.SystemDockerSocket, "homerun.example.com", "amd64",
	)
	if err != nil {
		t.Fatal(err)
	}
	if !run.ran("network create --driver overlay --attachable homerun-swarm") {
		t.Errorf("a rootful install needs the swarm overlay, ran %v", run.commands())
	}
	if !run.ran("docker compose -f") {
		t.Error("a full install brings up the stack")
	}
	if run.ran("homerun-worker-") {
		t.Error("a full install doesn't install the worker binary on the host")
	}
	create := run.callFor(t, "network create homerun")
	if create.Opts.As != "" {
		t.Errorf("the system daemon is reached as root, got %q", create.Opts.As)
	}
}

func TestInstallDockerRootlessAndRootful(t *testing.T) {
	withHomeRoot(t, "homerun")
	stubCommandExists(t, "docker", "apt-get")
	stubCommandOutput(t, map[string]string{"hostname -I": "203.0.113.10\n"})

	run := newFakeRunner().answers("id -u", "1000\n")
	socket, host, err := installer.InstallDocker(
		installer.Options{Mode: installer.ModeAgent, RootlessUser: "homerun"}, run, installer.FlavourRootless,
	)
	if err != nil {
		t.Fatal(err)
	}
	if socket != "/run/user/1000/docker.sock" {
		t.Errorf("got %q", socket)
	}
	if host != "" {
		t.Errorf("an agent install needs no host, got %q", host)
	}
	if !run.ran("apt-get install -y uidmap dbus-user-session") {
		t.Error("a rootless install needs its prerequisites")
	}

	stubTTY(t, false)
	run = newFakeRunner().answers("docker info", "active true\n")
	socket, host, err = installer.InstallDocker(
		installer.Options{Mode: installer.ModeFull, RootlessUser: "homerun"}, run, installer.FlavourRootful,
	)
	if err != nil {
		t.Fatal(err)
	}
	if socket != installer.SystemDockerSocket {
		t.Errorf("got %q", socket)
	}
	if host != "203.0.113.10" {
		t.Errorf("a full install resolves its host up front, got %q", host)
	}
	if !run.ran("usermod -aG docker homerun") {
		t.Error("the install user needs to reach the system socket")
	}
	if run.ran("uidmap") {
		t.Error("a rootful install needs no rootless prerequisites")
	}
}

func TestPrintNextStepsPerMode(t *testing.T) {
	withHomeRoot(t, "homerun")

	agent := captureStdout(t, func() {
		installer.PrintNextSteps(installer.Options{AgentPort: 7420, Mode: installer.ModeAgent, RootlessUser: "homerun"}, "/run/user/1000/docker.sock", "")
	})
	if !strings.Contains(agent, "listening on port 7420") || !strings.Contains(agent, ".homerun-worker/token") {
		t.Errorf("an agent install should point at its port and token:\n%s", agent)
	}

	rootless := captureStdout(t, func() {
		installer.PrintNextSteps(
			installer.Options{Docker: installer.FlavourRootless, Mode: installer.ModeFull, RootlessUser: "homerun"},
			"/run/user/1000/docker.sock", "homerun.example.com",
		)
	})
	if !strings.Contains(rootless, "Dashboard: http://homerun.example.com:3000") {
		t.Errorf("a full install should print the dashboard URL:\n%s", rootless)
	}
	if !strings.Contains(rootless, "sudo -u homerun env DOCKER_HOST=unix:///run/user/1000/docker.sock docker compose") {
		t.Errorf("a rootless stack is checked as its own user:\n%s", rootless)
	}

	rootful := captureStdout(t, func() {
		installer.PrintNextSteps(installer.Options{Mode: installer.ModeFull, RootlessUser: "homerun"}, installer.SystemDockerSocket, "homerun.example.com")
	})
	if !strings.Contains(rootful, "  sudo docker compose -f") {
		t.Errorf("a rootful stack is checked with plain sudo:\n%s", rootful)
	}
}

func TestInstallRefusesANonLinuxHostOutsideDryRun(t *testing.T) {
	if err := installer.RequireLinux(); err == nil {
		t.Skip("this test only means anything off Linux")
	}
	if err := installer.Install(installer.Options{Mode: installer.ModeAgent, RootlessUser: "homerun"}); err == nil {
		t.Error("a real install should refuse to run anywhere but Linux")
	}
}

// stubTTY forces installer.StdinIsTTY's answer for one test.
func stubTTY(t *testing.T, isTTY bool) {
	t.Helper()
	original := installer.StdinIsTTY
	installer.StdinIsTTY = func() bool { return isTTY }
	t.Cleanup(func() { installer.StdinIsTTY = original })
}

func TestStepRunnerDryRunTouchesNothing(t *testing.T) {
	dir := t.TempDir()
	run := installer.NewStepRunner(true)

	out := captureStdout(t, func() {
		if _, err := run.Run([]string{"rm", "-rf", dir}, installer.Opts{Cwd: dir}); err != nil {
			t.Error(err)
		}
		if err := run.WriteFile(dir+"/written", "x"); err != nil {
			t.Error(err)
		}
		if err := run.AppendLine(dir+"/appended", "y"); err != nil {
			t.Error(err)
		}
	})

	if !strings.Contains(out, "[dry-run] rm -rf "+dir+" (cwd="+dir+")") {
		t.Errorf("a dry run should echo the command and its cwd:\n%s", out)
	}
	if installer.FileExists(dir + "/written") {
		t.Error("--dry-run must not write files")
	}
	if installer.FileExists(dir + "/appended") {
		t.Error("--dry-run must not append to files")
	}
	if !installer.FileExists(dir) {
		t.Fatal("--dry-run must not run the command")
	}
}

func TestStepRunnerRunsAndReportsFailure(t *testing.T) {
	run := installer.NewStepRunner(false)

	captureStdout(t, func() {
		result, err := run.Run([]string{"echo", "hello"}, installer.Opts{})
		if err != nil {
			t.Error(err)
		}
		if strings.TrimSpace(result.Stdout) != "hello" {
			t.Errorf("stdout should be captured, got %q", result.Stdout)
		}
	})

	captureStdout(t, func() {
		_, err := run.Run([]string{"sh", "-c", "exit 3"}, installer.Opts{})
		if err == nil || !strings.Contains(err.Error(), "command failed (3)") {
			t.Errorf("a non-zero exit should carry its code, got %v", err)
		}
		if run.RunOK([]string{"sh", "-c", "exit 1"}, installer.Opts{}) {
			t.Error("RunOK should report a failure as false")
		}
		if !run.RunOK([]string{"true"}, installer.Opts{}) {
			t.Error("RunOK should report success as true")
		}
	})
}

func TestStepRunnerWritesAndAppends(t *testing.T) {
	dir := t.TempDir()
	run := installer.NewStepRunner(false)

	captureStdout(t, func() {
		if err := run.WriteFile(dir+"/nested/unit.service", "[Unit]\n"); err != nil {
			t.Error(err)
		}
		if err := run.AppendLine(dir+"/.env", "AUTH_SECRET=abc"); err != nil {
			t.Error(err)
		}
		if err := run.AppendLine(dir+"/.env", "ORIGIN=http://x"); err != nil {
			t.Error(err)
		}
	})

	unit, err := os.ReadFile(dir + "/nested/unit.service")
	if err != nil || string(unit) != "[Unit]\n" {
		t.Errorf("missing parent directories should be created, got %q %v", unit, err)
	}
	env, err := os.ReadFile(dir + "/.env")
	if err != nil {
		t.Fatal(err)
	}
	if string(env) != "AUTH_SECRET=abc\nORIGIN=http://x\n" {
		t.Errorf("appends should stack one per line, got %q", env)
	}
}

func TestStepRunnerThreadsEnvThroughSudo(t *testing.T) {
	full := installer.FullCommand([]string{"docker", "ps"}, installer.Opts{
		As:  "homerun",
		Env: map[string]string{"XDG_RUNTIME_DIR": "/run/user/1000", "HOME": "/home/homerun"},
	})
	got := strings.Join(full, " ")
	want := "sudo -u homerun -- env HOME=/home/homerun XDG_RUNTIME_DIR=/run/user/1000 docker ps"
	if got != want {
		t.Errorf("sudo resets the environment, so it has to be passed explicitly\n want %q\n  got %q", want, got)
	}

	if got := strings.Join(installer.FullCommand([]string{"id"}, installer.Opts{}), " "); got != "id" {
		t.Errorf("a plain command should be left alone, got %q", got)
	}
}
