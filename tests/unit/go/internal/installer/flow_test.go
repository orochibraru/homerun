package installer_test

import (
	"os"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/installer"
)

func TestRequireRoot(t *testing.T) {
	err := installer.RequireRoot()
	if os.Geteuid() == 0 {
		if err != nil {
			t.Errorf("running as root should be allowed, got %v", err)
		}
		return
	}
	if err == nil {
		t.Fatal("a non-root install should be refused")
	}
	if !strings.Contains(err.Error(), "re-run with sudo") {
		t.Errorf("the error should say how to fix it, got %q", err)
	}
}

func TestPromptHostReadsStdin(t *testing.T) {
	cases := []struct {
		name     string
		detected string
		typed    string
		want     string
	}{
		{"an answer wins", "203.0.113.10", "https://homerun.example.com/\n", "homerun.example.com"},
		{"a blank answer falls through", "203.0.113.10", "\n", ""},
		{"EOF falls through", "", "", ""},
	}
	for _, testCase := range cases {
		read, write, err := os.Pipe()
		if err != nil {
			t.Fatal(err)
		}
		if _, err := write.WriteString(testCase.typed); err != nil {
			t.Fatal(err)
		}
		write.Close()
		original := os.Stdin
		os.Stdin = read

		var got string
		out := captureStdout(t, func() { got = installer.PromptHost(testCase.detected) })
		os.Stdin = original
		read.Close()

		if got != testCase.want {
			t.Errorf("%s: want %q, got %q", testCase.name, testCase.want, got)
		}
		if testCase.detected != "" && !strings.Contains(out, testCase.detected) {
			t.Errorf("%s: the prompt should offer the detected address, got %q", testCase.name, out)
		}
	}
}

func TestResolveHostPromptsOnATTY(t *testing.T) {
	stubTTY(t, true)
	stubCommandOutput(t, map[string]string{"hostname -I": "203.0.113.10\n"})

	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := write.WriteString("typed.example.com\n"); err != nil {
		t.Fatal(err)
	}
	write.Close()
	original := os.Stdin
	os.Stdin = read
	defer func() {
		os.Stdin = original
		read.Close()
	}()

	var host string
	captureStdout(t, func() { host, err = installer.ResolveHost(installer.Options{}) })
	if err != nil {
		t.Fatal(err)
	}
	if host != "typed.example.com" {
		t.Errorf("a typed answer should win over detection, got %q", host)
	}
}

func TestResolveHostSkipsThePromptWithYes(t *testing.T) {
	stubTTY(t, true)
	stubCommandOutput(t, map[string]string{"hostname -I": "203.0.113.10\n"})

	var host string
	var err error
	captureStdout(t, func() { host, err = installer.ResolveHost(installer.Options{Yes: true}) })
	if err != nil || host != "203.0.113.10" {
		t.Errorf("curl | bash can't answer a prompt, got %q %v", host, err)
	}
}

func TestInstallDryRunWholeFlow(t *testing.T) {
	withHomeRoot(t, "homerun")
	stubTTY(t, false)
	stubCommandExists(t, "docker", "apt-get")
	stubCommandOutput(t, map[string]string{"hostname -I": "203.0.113.10\n"})

	agent := captureStdout(t, func() {
		if err := installer.Install(installer.Options{
			AgentPort: 7420, DryRun: true, Mode: installer.ModeAgent, RootlessUser: "homerun", Version: "latest",
		}); err != nil {
			t.Error(err)
		}
	})
	for _, fragment := range []string{
		"== 1/5 Docker engine + rootless prerequisites ==",
		"== 5/5 Install ==",
		"[dry-run] loginctl enable-linger homerun",
		"homerun-agent.service",
		"Homerun Agent should now be listening on port 7420.",
	} {
		if !strings.Contains(agent, fragment) {
			t.Errorf("an agent dry run should mention %q:\n%s", fragment, agent)
		}
	}

	full := captureStdout(t, func() {
		if err := installer.Install(installer.Options{
			DryRun: true, Mode: installer.ModeFull, RootlessUser: "homerun", Version: "v1.2.3",
			Domain: "homerun.example.com",
		}); err != nil {
			t.Error(err)
		}
	})
	for _, fragment := range []string{
		"== 3/5 System Docker daemon + swarm manager ==",
		"[dry-run] docker swarm init --advertise-addr 203.0.113.10",
		"Dashboard: http://homerun.example.com:3000",
	} {
		if !strings.Contains(full, fragment) {
			t.Errorf("a full dry run should mention %q:\n%s", fragment, full)
		}
	}
}

func TestInstallSurfacesAStepFailure(t *testing.T) {
	withHomeRoot(t, "homerun")
	stubCommandExists(t)

	err := installer.Install(installer.Options{DryRun: true, Mode: installer.ModeAgent, RootlessUser: "homerun", Version: "latest"})
	if err == nil {
		t.Skip("--dry-run runs nothing for real, so there is nothing to fail here")
	}
}

func TestMigrateToRootfulPrintsWhatIsLeftByHand(t *testing.T) {
	home := withHomeRoot(t, "homerun")
	composeDir := home + "/homerun"
	if err := os.WriteFile(composeDir+"/compose.yaml", []byte("services: {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	run := newFakeRunner().
		fails("network inspect --format").
		answers("id -u", "1000\n").
		answers("docker info", "inactive false\n").
		answers("docker ps -a", "leftover\tredis\t\t\t\n").
		answers("docker ps -q", "").
		answers("docker volume ls", "")

	out := captureStdout(t, func() {
		if err := installer.MigrateToRootful(installer.Options{
			Domain: "homerun.example.com", RootlessUser: "homerun", Version: "v1.2.3",
		}, run); err != nil {
			t.Error(err)
		}
	})

	for _, fragment := range []string{
		"Homerun now runs on the system Docker daemon in swarm mode",
		"weren't created by Homerun",
		"leftover (redis)",
		"dockerd-rootless-setuptool.sh uninstall",
	} {
		if !strings.Contains(out, fragment) {
			t.Errorf("the summary should mention %q:\n%s", fragment, out)
		}
	}
}

func TestMigrateToRootfulSurfacesAFailure(t *testing.T) {
	withHomeRoot(t, "homerun")
	run := newFakeRunner()

	err := installer.MigrateToRootful(installer.Options{RootlessUser: "homerun"}, run)
	if err == nil || !strings.Contains(err.Error(), "nothing to migrate") {
		t.Errorf("a failed migration should surface, got %v", err)
	}
}

func TestCopyPending(t *testing.T) {
	stateDir := t.TempDir()
	volumesFile := stateDir + "/volumes.json"

	pending, err := installer.CopyPending(volumesFile, stateDir)
	if err != nil || !pending {
		t.Errorf("no recorded volume list means everything is still pending, got %t %v", pending, err)
	}

	if err := os.WriteFile(volumesFile, []byte(`[{"Name":"a"},{"Name":"b"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	if pending, _ := installer.CopyPending(volumesFile, stateDir); !pending {
		t.Error("a volume with no marker is still pending")
	}

	for _, name := range []string{"a", "b"} {
		if err := os.WriteFile(stateDir+"/"+name+".copied", nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	if pending, _ := installer.CopyPending(volumesFile, stateDir); pending {
		t.Error("every marker present means nothing is pending")
	}

	if err := os.WriteFile(volumesFile, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.CopyPending(volumesFile, stateDir); err == nil {
		t.Error("an unreadable volume list should be an error, not a silent re-copy")
	}
}

func TestRecordVolumes(t *testing.T) {
	volumesFile := t.TempDir() + "/volumes.json"

	run := newFakeRunner().answers("docker volume ls", "\n")
	volumes, err := installer.RecordVolumes(run, true, installer.Opts{}, volumesFile)
	if err != nil || len(volumes) != 0 {
		t.Fatalf("a daemon with no named volumes records an empty list, got %v %v", volumes, err)
	}
	if run.writes[volumesFile] != "[]" {
		t.Errorf("the empty list should still be recorded, wrote %q", run.writes[volumesFile])
	}

	run = newFakeRunner()
	volumes, err = installer.RecordVolumes(run, false, installer.Opts{}, volumesFile)
	if err != nil || volumes != nil {
		t.Errorf("an unreachable daemon with no record has nothing to report, got %v %v", volumes, err)
	}

	if err := os.WriteFile(volumesFile, []byte(`[{"Name":"homerun-data"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	run = newFakeRunner()
	volumes, err = installer.RecordVolumes(run, true, installer.Opts{}, volumesFile)
	if err != nil || len(volumes) != 1 || volumes[0].Name != "homerun-data" {
		t.Fatalf("an existing record should be reused, got %v %v", volumes, err)
	}
	if len(run.calls) != 0 {
		t.Error("a recorded list should not re-list the daemon")
	}

	if err := os.WriteFile(volumesFile, []byte("{not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := installer.RecordVolumes(newFakeRunner(), true, installer.Opts{}, volumesFile); err == nil {
		t.Error("a corrupt record should be an error")
	}
}

func TestStepFailuresPropagate(t *testing.T) {
	cases := []struct {
		name  string
		fails []string
		call  func(installer.Runner) error
	}{
		{"engine install", []string{"get.docker.com"}, func(r installer.Runner) error { stubCommandExists(t); return installer.InstallDockerEngine(r) }},
		{"prereqs", []string{"apt-get"}, func(r installer.Runner) error {
			return installer.InstallRootlessPrereqs(r, installer.PackageManager{Install: []string{"apt-get", "install", "-y"}, Kind: "apt"})
		}},
		{"useradd", []string{"id homerun", "useradd"}, func(r installer.Runner) error { return installer.EnsureRootlessUser(r, "homerun") }},
		{"linger", []string{"loginctl"}, func(r installer.Runner) error { _, err := installer.InstallRootlessDocker(r, "homerun"); return err }},
		{"rootful enable", []string{"systemctl enable"}, func(r installer.Runner) error { _, err := installer.EnableRootfulDocker(r); return err }},
		{"docker group", []string{"usermod"}, func(r installer.Runner) error { return installer.AddUserToDockerGroup(r, "homerun") }},
		{"network create", []string{"network"}, func(r installer.Runner) error {
			return installer.EnsureHomerunNetwork(r, "", installer.SystemDockerSocket)
		}},
		{"swarm info", []string{"docker info"}, func(r installer.Runner) error { return installer.EnsureSwarmManager(r, "") }},
		{"agent unit", []string{"mkdir -p"}, func(r installer.Runner) error {
			return installer.InstallAgentSystemdUnit(r, "homerun", "/run/user/1000/docker.sock", 7420)
		}},
		{"compose up", []string{"up -d"}, func(r installer.Runner) error {
			_, err := installer.BringUpFullStack(installer.FullStackParams{
				DockerSocket: installer.SystemDockerSocket, Host: "x", Rootful: true, Run: r, Username: "homerun", Version: "latest",
			})
			return err
		}},
	}
	for _, testCase := range cases {
		withHomeRoot(t, "homerun")
		run := newFakeRunner()
		for _, failure := range testCase.fails {
			run.fails(failure)
		}
		captureStdout(t, func() {
			if err := testCase.call(run); err == nil {
				t.Errorf("%s: a failed command should stop the install", testCase.name)
			}
		})
	}
}
