package installer_test

import (
	"os"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/release"

	"github.com/orochibraru/homerun/internal/installer"
)

func TestDetectPackageManager(t *testing.T) {
	cases := []struct {
		name    string
		present []string
		wantPM  string
	}{
		{"apt wins", []string{"apt-get", "dnf", "yum"}, "apt"},
		{"dnf next", []string{"dnf", "yum"}, "dnf"},
		{"yum last", []string{"yum"}, "yum"},
	}
	for _, testCase := range cases {
		stubCommandExists(t, testCase.present...)
		pm, err := installer.DetectPackageManager()
		if err != nil {
			t.Fatalf("%s: %v", testCase.name, err)
		}
		if pm.Kind != testCase.wantPM {
			t.Errorf("%s: want %q, got %q", testCase.name, testCase.wantPM, pm.Kind)
		}
		if len(pm.Install) == 0 {
			t.Errorf("%s: install argv should not be empty", testCase.name)
		}
	}

	stubCommandExists(t)
	if _, err := installer.DetectPackageManager(); err == nil {
		t.Error("a host with no package manager should be an error")
	}
}

func TestFirstRoutableAddressSkipsLoopback(t *testing.T) {
	cases := []struct {
		candidates []string
		want       string
	}{
		{[]string{"127.0.0.1", "192.168.1.5"}, "192.168.1.5"},
		{[]string{"::1", "10.0.0.2"}, "10.0.0.2"},
		{[]string{"", "203.0.113.10"}, "203.0.113.10"},
		{[]string{"127.0.0.1", "::1"}, ""},
		{nil, ""},
	}
	for _, testCase := range cases {
		if got := installer.FirstRoutableAddress(testCase.candidates); got != testCase.want {
			t.Errorf("%v: want %q, got %q", testCase.candidates, testCase.want, got)
		}
	}
}

func TestHostAddress(t *testing.T) {
	stubCommandOutput(t, map[string]string{
		"ip -4 route get 1.1.1.1": "1.1.1.1 via 10.0.0.1 dev eth0 src 10.0.0.42 uid 0",
	})
	if got := installer.HostAddress(); got != "10.0.0.42" {
		t.Errorf("the route's src address should win, got %q", got)
	}

	stubCommandOutput(t, map[string]string{"hostname -I": "127.0.0.1 192.168.0.9 \n"})
	if got := installer.HostAddress(); got != "192.168.0.9" {
		t.Errorf("should fall back to hostname -I, skipping loopback, got %q", got)
	}

	stubCommandOutput(t, map[string]string{})
	if got := installer.HostAddress(); got != "" {
		t.Errorf("nothing detectable should be empty, got %q", got)
	}
}

func TestArch(t *testing.T) {
	arch, err := installer.Arch()
	if err != nil {
		t.Fatalf("this test runs on amd64 or arm64: %v", err)
	}
	if arch != "amd64" && arch != "arm64" {
		t.Errorf("unexpected arch %q", arch)
	}
}

func TestReleaseAssetURL(t *testing.T) {
	latest := release.AssetURL("latest", "homerun-worker-amd64.gz")
	if latest != "https://github.com/orochibraru/homerun/releases/latest/download/homerun-worker-amd64.gz" {
		t.Errorf("latest should use the latest-download path, got %q", latest)
	}
	pinned := release.AssetURL("v1.2.3", "homerun-cli-arm64.gz")
	if pinned != "https://github.com/orochibraru/homerun/releases/download/v1.2.3/homerun-cli-arm64.gz" {
		t.Errorf("a tag should pin that release, got %q", pinned)
	}
}

func TestImageRef(t *testing.T) {
	if got := release.ImageRef("latest"); got != "docker.io/orochibraru/homerun:latest" {
		t.Errorf("got %q", got)
	}
	if got := release.ImageRef("v1.2.3"); got != "docker.io/orochibraru/homerun:v1.2.3" {
		t.Errorf("got %q", got)
	}
}

func TestDownloadReleaseBinaryUnpacksThenRenames(t *testing.T) {
	run := newFakeRunner()
	if err := installer.DownloadReleaseBinary(run, "v1.2.3", "homerun-worker-arm64", "/usr/local/bin/homerun-worker"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"curl -fsSL https://github.com/orochibraru/homerun/releases/download/v1.2.3/homerun-worker-arm64.gz -o /usr/local/bin/homerun-worker.download.gz",
		"gunzip -f /usr/local/bin/homerun-worker.download.gz",
		"chmod +x /usr/local/bin/homerun-worker.download",
		"mv -f /usr/local/bin/homerun-worker.download /usr/local/bin/homerun-worker",
	}
	got := run.commands()
	if len(got) != len(want) {
		t.Fatalf("want %d commands, got %v", len(want), got)
	}
	for i, command := range want {
		if got[i] != command {
			t.Errorf("step %d:\n want %q\n  got %q", i, command, got[i])
		}
	}
}

func TestDownloadReleaseBinaryStopsOnFailure(t *testing.T) {
	run := newFakeRunner().fails("curl")
	if err := installer.DownloadReleaseBinary(run, "latest", "homerun-worker-amd64", "/usr/local/bin/homerun-worker"); err == nil {
		t.Fatal("a failed download should be an error")
	}
	if run.ran("mv -f") {
		t.Error("nothing should be renamed over the destination after a failed download")
	}
}

func TestInstallDockerEngineSkipsWhenPresent(t *testing.T) {
	stubCommandExists(t, "docker")
	run := newFakeRunner()
	if err := installer.InstallDockerEngine(run); err != nil {
		t.Fatal(err)
	}
	if len(run.calls) != 0 {
		t.Errorf("an existing Docker should be left alone, ran %v", run.commands())
	}

	stubCommandExists(t)
	run = newFakeRunner()
	if err := installer.InstallDockerEngine(run); err != nil {
		t.Fatal(err)
	}
	if !run.ran("get.docker.com") {
		t.Errorf("a host without Docker should run the convenience script, ran %v", run.commands())
	}
}

func TestInstallRootlessPrereqsPerPackageManager(t *testing.T) {
	run := newFakeRunner()
	if err := installer.InstallRootlessPrereqs(run, installer.PackageManager{Install: []string{"apt-get", "install", "-y"}, Kind: "apt"}); err != nil {
		t.Fatal(err)
	}
	if got := run.commands()[0]; got != "apt-get install -y uidmap dbus-user-session" {
		t.Errorf("apt should install uidmap and dbus-user-session, got %q", got)
	}

	run = newFakeRunner()
	if err := installer.InstallRootlessPrereqs(run, installer.PackageManager{Install: []string{"dnf", "install", "-y"}, Kind: "dnf"}); err != nil {
		t.Fatal(err)
	}
	if got := run.commands()[0]; got != "dnf install -y shadow-utils" {
		t.Errorf("dnf should install shadow-utils, got %q", got)
	}
}

func TestEnsureRootlessUserIsIdempotent(t *testing.T) {
	run := newFakeRunner()
	if err := installer.EnsureRootlessUser(run, "homerun"); err != nil {
		t.Fatal(err)
	}
	if run.ran("useradd") {
		t.Error("an existing user should be reused, not recreated")
	}

	run = newFakeRunner().fails("id homerun")
	if err := installer.EnsureRootlessUser(run, "homerun"); err != nil {
		t.Fatal(err)
	}
	if !run.ran("useradd --create-home --shell /bin/bash homerun") {
		t.Errorf("a missing user should be created, ran %v", run.commands())
	}
}

func TestInstallRootlessDockerRunsAsTheUser(t *testing.T) {
	withHomeRoot(t, "homerun")
	run := newFakeRunner().answers("id -u", "1234\n")

	socket, err := installer.InstallRootlessDocker(run, "homerun")
	if err != nil {
		t.Fatal(err)
	}
	if socket != "/run/user/1234/docker.sock" {
		t.Errorf("the rootless socket should follow the uid, got %q", socket)
	}
	if !run.ran("loginctl enable-linger homerun") {
		t.Error("lingering is what keeps the daemon alive on a headless box")
	}

	install := run.callFor(t, "get.docker.com/rootless")
	if install.Opts.As != "homerun" {
		t.Errorf("the rootless install must run as the user, got %q", install.Opts.As)
	}
	if install.Opts.Env["XDG_RUNTIME_DIR"] != "/run/user/1234" {
		t.Errorf("XDG_RUNTIME_DIR should follow the uid, got %v", install.Opts.Env)
	}
}

func TestInstallRootlessDockerSkipsAnExistingInstall(t *testing.T) {
	home := withHomeRoot(t, "homerun")
	if err := os.MkdirAll(home+"/bin", 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(home+"/bin/dockerd", []byte("#!/bin/sh\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	run := newFakeRunner().answers("id -u", "1234\n")

	if _, err := installer.InstallRootlessDocker(run, "homerun"); err != nil {
		t.Fatal(err)
	}
	if run.ran("get.docker.com/rootless") {
		t.Error("an existing rootless install should not be reinstalled")
	}
	if !run.ran("systemctl --user enable --now docker") {
		t.Error("it should still be enabled, in case a previous run stopped there")
	}
}

func TestUidOfFallsBackTo1000(t *testing.T) {
	uid, err := installer.UIDOf(newFakeRunner(), "homerun")
	if err != nil {
		t.Fatal(err)
	}
	if uid != "1000" {
		t.Errorf("an empty id output should fall back to 1000, got %q", uid)
	}

	uid, err = installer.UIDOf(newFakeRunner().answers("id -u", " 4242 \n"), "homerun")
	if err != nil {
		t.Fatal(err)
	}
	if uid != "4242" {
		t.Errorf("want 4242, got %q", uid)
	}
}

func TestAllowRootlessUsernsOnlyWhenRestricted(t *testing.T) {
	withHomeRoot(t, "homerun")
	sysctl := t.TempDir() + "/userns"
	original := installer.UsernsSysctlPath
	installer.UsernsSysctlPath = sysctl
	t.Cleanup(func() { installer.UsernsSysctlPath = original })

	run := newFakeRunner()
	if err := installer.AllowRootlessUserns(run, "homerun"); err != nil {
		t.Fatal(err)
	}
	if len(run.writes) != 0 {
		t.Error("no sysctl file at all means nothing to work around")
	}

	if err := os.WriteFile(sysctl, []byte("0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run = newFakeRunner()
	if err := installer.AllowRootlessUserns(run, "homerun"); err != nil {
		t.Fatal(err)
	}
	if len(run.writes) != 0 {
		t.Error("an unrestricted host needs no profile")
	}

	if err := os.WriteFile(sysctl, []byte("1\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run = newFakeRunner()
	if err := installer.AllowRootlessUserns(run, "homerun"); err != nil {
		t.Fatal(err)
	}
	profile, ok := run.writes["/etc/apparmor.d/home.homerun.bin.rootlesskit"]
	if !ok {
		t.Fatalf("a restricted host needs the AppArmor profile, wrote %v", run.writes)
	}
	if !strings.Contains(profile, "userns,") || !strings.Contains(profile, "/bin/rootlesskit flags=(unconfined)") {
		t.Errorf("unexpected profile:\n%s", profile)
	}
	if !run.ran("systemctl restart apparmor.service") {
		t.Error("the profile only takes effect after apparmor reloads")
	}
}

func TestEnableRootfulDockerAndGroup(t *testing.T) {
	run := newFakeRunner()
	socket, err := installer.EnableRootfulDocker(run)
	if err != nil {
		t.Fatal(err)
	}
	if socket != installer.SystemDockerSocket {
		t.Errorf("want the system socket, got %q", socket)
	}
	if !run.ran("systemctl enable --now docker") {
		t.Error("the system daemon should be enabled and started")
	}

	run = newFakeRunner()
	if err := installer.AddUserToDockerGroup(run, "deployer"); err != nil {
		t.Fatal(err)
	}
	if !run.ran("usermod -aG docker deployer") {
		t.Errorf("ran %v", run.commands())
	}
}

func TestEnsureHomerunNetwork(t *testing.T) {
	withHomeRoot(t, "homerun")

	run := newFakeRunner()
	if err := installer.EnsureHomerunNetwork(run, "homerun", "/run/user/1000/docker.sock"); err != nil {
		t.Fatal(err)
	}
	if run.ran("network create") {
		t.Error("an existing network should not be recreated")
	}
	inspect := run.callFor(t, "network inspect")
	if inspect.Opts.As != "homerun" || inspect.Opts.Env["DOCKER_HOST"] != "unix:///run/user/1000/docker.sock" {
		t.Errorf("the rootless daemon should be addressed as its user, got %+v", inspect.Opts)
	}

	run = newFakeRunner().fails("network inspect")
	if err := installer.EnsureHomerunNetwork(run, "", installer.SystemDockerSocket); err != nil {
		t.Fatal(err)
	}
	create := run.callFor(t, "network create")
	if create.Opts.As != "" {
		t.Errorf("the system daemon is reached directly by root, got As=%q", create.Opts.As)
	}
	if create.Opts.Env["HOME"] != "" {
		t.Error("no HOME should be threaded through for the system daemon")
	}
}

func TestParseSwarmNodeState(t *testing.T) {
	cases := map[string]installer.SwarmNodeState{
		"active true":         installer.SwarmManager,
		"active false":        installer.SwarmWorker,
		"inactive false":      installer.SwarmInactive,
		"pending true":        installer.SwarmInactive,
		"":                    installer.SwarmInactive,
		"  active   true  \n": installer.SwarmManager,
	}
	for output, want := range cases {
		if got := installer.ParseSwarmNodeState(output); got != want {
			t.Errorf("%q: want %q, got %q", output, want, got)
		}
	}
}

func TestSwarmInitCommand(t *testing.T) {
	if got := strings.Join(installer.SwarmInitCommand(""), " "); got != "docker swarm init" {
		t.Errorf("got %q", got)
	}
	if got := strings.Join(installer.SwarmInitCommand("10.0.0.5"), " "); got != "docker swarm init --advertise-addr 10.0.0.5" {
		t.Errorf("got %q", got)
	}
}

func TestEnsureSwarmManager(t *testing.T) {
	run := newFakeRunner().answers("docker info", "active true\n")
	if err := installer.EnsureSwarmManager(run, "10.0.0.5"); err != nil {
		t.Fatal(err)
	}
	if run.ran("swarm init") {
		t.Error("an existing manager should not re-init")
	}

	run = newFakeRunner().answers("docker info", "active false\n")
	err := installer.EnsureSwarmManager(run, "")
	if err == nil || !strings.Contains(err.Error(), "worker in another swarm") {
		t.Errorf("a worker should be refused, got %v", err)
	}

	run = newFakeRunner().answers("docker info", "inactive false\n")
	if err := installer.EnsureSwarmManager(run, "10.0.0.5"); err != nil {
		t.Fatal(err)
	}
	init := run.callFor(t, "swarm init")
	if strings.Join(init.Cmd, " ") != "docker swarm init --advertise-addr 10.0.0.5" {
		t.Errorf("got %q", strings.Join(init.Cmd, " "))
	}

	run = newFakeRunner().answers("docker info", "inactive false\n").fails("swarm init")
	err = installer.EnsureSwarmManager(run, "10.0.0.5")
	if err == nil || !strings.Contains(err.Error(), "--advertise-addr") {
		t.Errorf("a failed init should suggest --advertise-addr, got %v", err)
	}
}

func TestEnsureOverlayNetwork(t *testing.T) {
	run := newFakeRunner().answers("network inspect", "overlay true\n")
	if err := installer.EnsureOverlayNetwork(run); err != nil {
		t.Fatal(err)
	}
	if run.ran("network create") {
		t.Error("an existing overlay should be left alone")
	}

	run = newFakeRunner().answers("network inspect", "bridge false\n")
	err := installer.EnsureOverlayNetwork(run)
	if err == nil || !strings.Contains(err.Error(), "docker network rm") {
		t.Errorf("a wrongly-shaped network should say how to fix it, got %v", err)
	}

	run = newFakeRunner().fails("network inspect")
	if err := installer.EnsureOverlayNetwork(run); err != nil {
		t.Fatal(err)
	}
	create := run.callFor(t, "network create")
	if strings.Join(create.Cmd, " ") != "docker network create --driver overlay --attachable homerun-swarm" {
		t.Errorf("got %q", strings.Join(create.Cmd, " "))
	}
	if create.Opts.Env["DOCKER_HOST"] != "unix://"+installer.SystemDockerSocket {
		t.Error("the overlay only exists on the system daemon")
	}
}

func TestWorkerSystemdUnit(t *testing.T) {
	unit := installer.WorkerSystemdUnit(installer.WorkerUnitParams{
		BinaryPath:   "/usr/local/bin/homerun-worker",
		DockerSocket: "/run/user/1000/docker.sock",
		Port:         7420,
		TokenFile:    "/home/homerun/.homerun-worker/token",
	})
	for _, line := range []string{
		"ExecStart=/usr/local/bin/homerun-worker",
		"Environment=WORKER_PORT=7420",
		"Environment=DOCKER_SOCKET_PATH=/run/user/1000/docker.sock",
		"Environment=WORKER_TOKEN_FILE=/home/homerun/.homerun-worker/token",
		"WantedBy=default.target",
		"Restart=on-failure",
	} {
		if !strings.Contains(unit, line) {
			t.Errorf("unit is missing %q:\n%s", line, unit)
		}
	}
	if strings.Contains(unit, "DATABASE_URL") {
		t.Errorf("a DATABASE_URL would turn agent mode into a full worker:\n%s", unit)
	}
}

func TestInstallWorkerBinaryAndUnit(t *testing.T) {
	home := withHomeRoot(t, "homerun")
	run := newFakeRunner().answers("id -u", "1500\n")

	path, err := installer.InstallWorkerBinary(run, "latest", "arm64")
	if err != nil {
		t.Fatal(err)
	}
	if path != "/usr/local/bin/homerun-worker" {
		t.Errorf("got %q", path)
	}
	if !run.ran("homerun-worker-arm64.gz") {
		t.Errorf("the arch's asset should be downloaded, ran %v", run.commands())
	}

	run = newFakeRunner().answers("id -u", "1500\n")
	if err := installer.InstallWorkerSystemdUnit(run, "homerun", "/run/user/1500/docker.sock", 7420); err != nil {
		t.Fatal(err)
	}
	unitPath := home + "/.config/systemd/user/homerun-worker.service"
	unit, ok := run.writes[unitPath]
	if !ok {
		t.Fatalf("the unit should be written to %s, wrote %v", unitPath, run.writes)
	}
	if !strings.Contains(unit, "DOCKER_SOCKET_PATH=/run/user/1500/docker.sock") {
		t.Errorf("the unit should point at the rootless socket:\n%s", unit)
	}
	for _, command := range []string{
		"systemctl --user disable --now homerun-agent",
		"rm -f " + home + "/.config/systemd/user/homerun-agent.service /usr/local/bin/homerun-agent",
		"systemctl --user daemon-reload",
		"systemctl --user enable homerun-worker",
		"systemctl --user restart homerun-worker",
	} {
		if !run.ran(command) {
			t.Errorf("missing %q in %v", command, run.commands())
		}
	}
	restart := run.callFor(t, "restart homerun-worker")
	if restart.Opts.As != "homerun" || restart.Opts.Env["XDG_RUNTIME_DIR"] != "/run/user/1500" {
		t.Errorf("the unit is a systemd --user one, got %+v", restart.Opts)
	}
}

func TestInstallWorkerUnitToleratesNoLegacyAgent(t *testing.T) {
	withHomeRoot(t, "homerun")
	run := newFakeRunner().answers("id -u", "1500\n").fails("disable --now homerun-agent")
	if err := installer.InstallWorkerSystemdUnit(run, "homerun", "/run/user/1500/docker.sock", 7420); err != nil {
		t.Fatalf("a host with no leftover homerun-agent unit should still install: %v", err)
	}
	if !run.ran("restart homerun-worker") {
		t.Errorf("the worker should still be started, ran %v", run.commands())
	}
}
