package installer_test

import (
	"os"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/installer"
)

func TestCopyableVolumesSkipsAnonymous(t *testing.T) {
	anonymous := strings.Repeat("a1b2c3d4", 8)
	got := installer.CopyableVolumes([]string{" homerun-data ", anonymous, "", "postgres-data", "  "})
	if strings.Join(got, ",") != "homerun-data,postgres-data" {
		t.Errorf("got %v", got)
	}
}

func TestHostFromCompose(t *testing.T) {
	cases := map[string]string{
		"ORIGIN: ${ORIGIN:-http://homerun.example.com:3000}": "homerun.example.com",
		"ORIGIN: ${ORIGIN:-https://homerun.example.com}":     "homerun.example.com",
		"ORIGIN: ${ORIGIN:-http://203.0.113.10:3000}":        "203.0.113.10",
		"ORIGIN: ${ORIGIN:-http://localhost:3000}":           "",
		"ORIGIN: ${ORIGIN:-http://127.0.0.1:3000}":           "",
		"nothing here": "",
	}
	for compose, want := range cases {
		if got := installer.HostFromCompose(compose); got != want {
			t.Errorf("%q: want %q, got %q", compose, want, got)
		}
	}
}

func TestBaseDomainFromConfig(t *testing.T) {
	cases := map[string]string{
		"baseDomain: homerun.example.com\ndocker:\n": "homerun.example.com",
		"baseDomain: localhost\n":                    "",
		"baseDomain: 127.0.0.1\n":                    "",
		"docker:\n  socketPath: /x\n":                "",
	}
	for config, want := range cases {
		if got := installer.BaseDomainFromConfig(config); got != want {
			t.Errorf("%q: want %q, got %q", config, want, got)
		}
	}
}

func TestRootfulConfigRepointsTheSocket(t *testing.T) {
	config := "baseDomain: x\ndocker:\n  networkName: homerun\n  socketPath: /run/user/1000/docker.sock\n"
	got := installer.RootfulConfig(config)
	if !strings.Contains(got, "  socketPath: /var/run/docker.sock") {
		t.Errorf("got:\n%s", got)
	}
	if !strings.Contains(got, "networkName: homerun") {
		t.Error("the rest of the config should be untouched")
	}

	without := "baseDomain: x\n"
	if installer.RootfulConfig(without) != without {
		t.Error("a config with no socketPath should be returned unchanged")
	}
}

func TestEnvValue(t *testing.T) {
	envFile := "POSTGRES_USER=admin\nPOSTGRES_DB=\"homerun_prod\"\n  SPACED=yes\nAUTH_SECRET=abc\n"
	cases := map[string]string{
		"POSTGRES_USER": "admin",
		"POSTGRES_DB":   "homerun_prod",
		"SPACED":        "yes",
		"MISSING":       "",
	}
	for key, want := range cases {
		if got := installer.EnvValue(envFile, key); got != want {
			t.Errorf("%s: want %q, got %q", key, want, got)
		}
	}
}

func TestVolumeCreateCommand(t *testing.T) {
	got := strings.Join(installer.VolumeCreateCommand(installer.VolumeDefinition{
		Driver:  "local",
		Labels:  map[string]string{"com.docker.compose.project": "homerun", "a": "b"},
		Name:    "homerun-data",
		Options: map[string]string{"type": "none", "device": "/mnt/data"},
	}), " ")
	want := "docker volume create --driver local --label a=b --label com.docker.compose.project=homerun --opt device=/mnt/data --opt type=none homerun-data"
	if got != want {
		t.Errorf("\n want %q\n  got %q", want, got)
	}

	bare := strings.Join(installer.VolumeCreateCommand(installer.VolumeDefinition{Name: "x"}), " ")
	if bare != "docker volume create --driver local x" {
		t.Errorf("a volume with no driver should default to local, got %q", bare)
	}
}

func TestHoldsDataElsewhere(t *testing.T) {
	if !installer.HoldsDataElsewhere(installer.VolumeDefinition{Options: map[string]string{"device": "/mnt/data"}}) {
		t.Error("a device option means the data isn't in Docker's volume directory")
	}
	if installer.HoldsDataElsewhere(installer.VolumeDefinition{Options: map[string]string{"type": "none"}}) {
		t.Error("no device means an ordinary volume")
	}
	if installer.HoldsDataElsewhere(installer.VolumeDefinition{}) {
		t.Error("no options at all means an ordinary volume")
	}
}

func TestVolumeCopyScriptStreamsBetweenDaemons(t *testing.T) {
	script := installer.VolumeCopyScript("homerun-data", "/run/user/1000/docker.sock")
	if !strings.HasPrefix(script, "set -euo pipefail\n") {
		t.Error("a half-failed pipe must not look like success")
	}
	if !strings.Contains(script, "-H unix:///run/user/1000/docker.sock run --rm -v homerun-data:/from:ro") {
		t.Errorf("the source side is wrong:\n%s", script)
	}
	if !strings.Contains(script, "-H unix:///var/run/docker.sock run --rm -i -v homerun-data:/to") {
		t.Errorf("the destination side is wrong:\n%s", script)
	}
	if strings.Count(script, "--numeric-owner") != 2 {
		t.Error("ownership has to be carried numerically on both sides")
	}
}

func TestSwitchToSwarmSQLClearsARootlessSocket(t *testing.T) {
	for _, fragment := range []string{
		"orchestration_mode = 'swarm'",
		"pending_service_redeploy = true",
		"docker_socket_path LIKE '/run/user/%'",
	} {
		if !strings.Contains(installer.SwitchToSwarmSQL, fragment) {
			t.Errorf("the switch is missing %q", fragment)
		}
	}
}

func TestMigrateRequiresAnExistingInstall(t *testing.T) {
	withHomeRoot(t, "homerun")
	_, err := installer.Migrate(installer.MigrationParams{Run: newFakeRunner(), Username: "homerun"})
	if err == nil || !strings.Contains(err.Error(), "nothing to migrate") {
		t.Errorf("a host with no --mode=full install should say so, got %v", err)
	}
}

func TestMigrateFullRun(t *testing.T) {
	home := withHomeRoot(t, "homerun")
	composeDir := home + "/homerun"
	if err := os.WriteFile(
		composeDir+"/compose.yaml",
		[]byte("services:\n  app:\n    environment:\n      ORIGIN: ${ORIGIN:-http://homerun.example.com:3000}\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		composeDir+"/homerun.yaml",
		[]byte("baseDomain: homerun.example.com\ndocker:\n  socketPath: /run/user/1000/docker.sock\n"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(composeDir+"/.env", []byte("POSTGRES_USER=admin\nPOSTGRES_DB=homerun_prod\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	run := newFakeRunner().
		fails("network inspect --format").
		answers("id -u", "1000\n").
		answers("docker info", "inactive false\n").
		answers("docker ps -a", "homerun-app\timg\thomerun\t\t\nsvc\tnginx\t\ttrue\t\nrandom\tredis\t\t\t\n").
		answers("docker inspect", "/srv/data\n/srv/data\n").
		answers("docker ps -q", "abc123\n").
		answers("docker volume ls", "homerun-data\npostgres-data\n"+strings.Repeat("f", 64)+"\n").
		answers("docker volume inspect", `[{"Driver":"local","Labels":null,"Name":"homerun-data","Options":null},{"Driver":"local","Labels":null,"Name":"postgres-data","Options":null}]`)

	report, err := installer.Migrate(installer.MigrationParams{
		AdvertiseAddress: "10.0.0.5",
		Run:              run,
		Username:         "homerun",
		Version:          "v1.2.3",
		ResolveHost:      func() (string, error) { return "should-not-be-called", nil },
	})
	if err != nil {
		t.Fatal(err)
	}

	if report.RootlessSocket != "/run/user/1000/docker.sock" || report.UID != "1000" {
		t.Errorf("unexpected report: %+v", report)
	}
	if strings.Join(report.OtherContainers, ",") != "random (redis)" {
		t.Errorf("only containers that aren't the stack's or a service's need the operator, got %v", report.OtherContainers)
	}
	if strings.Join(report.BindMounts, ",") != "/srv/data" {
		t.Errorf("bind mounts should be de-duplicated, got %v", report.BindMounts)
	}

	for _, command := range []string{
		"docker stop abc123",
		"docker volume create --driver local homerun-data",
		"docker volume create --driver local postgres-data",
		"docker swarm init --advertise-addr 10.0.0.5",
		"docker network create --driver overlay --attachable homerun-swarm",
		"psql",
		"compose -f " + composeDir + "/compose.yaml restart app",
		"systemctl --user disable --now docker.service",
	} {
		if !run.ran(command) {
			t.Errorf("the migration never ran %q\nran: %v", command, run.commands())
		}
	}
	psql := run.callFor(t, "psql")
	joined := strings.Join(psql.Cmd, " ")
	if !strings.Contains(joined, "-U admin -d homerun_prod") {
		t.Errorf("the switch should use .env's credentials, got %q", joined)
	}
	if !strings.Contains(joined, installer.SwitchToSwarmSQL) {
		t.Error("the switch statement itself should be passed to psql")
	}

	config := run.writes[composeDir+"/homerun.yaml"]
	if !strings.Contains(config, "socketPath: /var/run/docker.sock") {
		t.Errorf("homerun.yaml should point at the system daemon now:\n%s", config)
	}
	if !run.ran("cp " + composeDir + "/compose.yaml " + composeDir + "/compose.rootless.yaml") {
		t.Error("the rootless compose file should be kept as a backup")
	}
	for _, marker := range []string{
		composeDir + "/.rootful-migration/homerun-data.copied",
		composeDir + "/.rootful-migration/postgres-data.copied",
		composeDir + "/.rootful-migration/instance-switched",
	} {
		if _, ok := run.writes[marker]; !ok {
			t.Errorf("a finished step should leave %s behind, wrote %v", marker, run.writes)
		}
	}
}

func TestCopyVolumesResumesAndRefusesAnUnreachableDaemon(t *testing.T) {
	stateDir := t.TempDir()
	volumesFile := stateDir + "/volumes.json"
	if err := os.WriteFile(volumesFile, []byte(`[{"Name":"homerun-data"},{"Name":"postgres-data"}]`), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stateDir+"/homerun-data.copied", nil, 0o644); err != nil {
		t.Fatal(err)
	}

	run := newFakeRunner()
	err := installer.CopyVolumes(run, false, installer.Opts{}, "/run/user/1000/docker.sock", stateDir, volumesFile)
	if err == nil || !strings.Contains(err.Error(), "postgres-data still needs copying") {
		t.Fatalf("an unreachable daemon with work left should fail loudly, got %v", err)
	}
	if run.ran("homerun-data") {
		t.Error("an already-copied volume should be skipped on a re-run")
	}

	run = newFakeRunner()
	if err := installer.CopyVolumes(run, true, installer.Opts{}, "/run/user/1000/docker.sock", stateDir, volumesFile); err != nil {
		t.Fatal(err)
	}
	if !run.ran("docker volume rm postgres-data") {
		t.Error("a half-copied volume is removed and copied again from scratch")
	}
	if !run.ran("tar -C /from --numeric-owner") {
		t.Error("the remaining volume should actually be copied")
	}
}

func TestCopyVolumesRecreatesADeviceVolumeWithoutCopying(t *testing.T) {
	stateDir := t.TempDir()
	volumesFile := stateDir + "/volumes.json"
	if err := os.WriteFile(
		volumesFile,
		[]byte(`[{"Name":"bind-data","Driver":"local","Options":{"device":"/mnt/data","type":"none"}}]`),
		0o644,
	); err != nil {
		t.Fatal(err)
	}

	run := newFakeRunner()
	if err := installer.CopyVolumes(run, true, installer.Opts{}, "/run/user/1000/docker.sock", stateDir, volumesFile); err != nil {
		t.Fatal(err)
	}
	if !run.ran("docker volume create --driver local --opt device=/mnt/data") {
		t.Errorf("the volume should still be recreated, ran %v", run.commands())
	}
	if run.ran("tar") {
		t.Error("data that lives outside Docker's volume directory has nothing to copy")
	}
}

func TestEnsureRootlessDaemonStartsItWhenCopyingIsPending(t *testing.T) {
	withHomeRoot(t, "homerun")

	run := newFakeRunner()
	reachable, err := installer.EnsureRootlessDaemon(run, true, installer.Opts{}, "homerun", "1000")
	if err != nil || !reachable {
		t.Fatalf("a daemon that answers is reachable, got %t %v", reachable, err)
	}
	if run.ran("systemctl --user start docker") {
		t.Error("a running daemon should not be started again")
	}

	run = newFakeRunner().fails("docker version")
	reachable, err = installer.EnsureRootlessDaemon(run, false, installer.Opts{}, "homerun", "1000")
	if err != nil || reachable {
		t.Fatalf("with nothing left to copy, a stopped daemon is fine, got %t %v", reachable, err)
	}
	if run.ran("systemctl --user start docker") {
		t.Error("nothing left to copy means no reason to start it")
	}

	run = newFakeRunner().fails("docker version")
	reachable, err = installer.EnsureRootlessDaemon(run, true, installer.Opts{}, "homerun", "1000")
	if err != nil || !reachable {
		t.Fatalf("a stopped daemon with work left should be started, got %t %v", reachable, err)
	}
	start := run.callFor(t, "systemctl --user start docker")
	if start.Opts.As != "homerun" || start.Opts.Env["XDG_RUNTIME_DIR"] != "/run/user/1000" {
		t.Errorf("it lives in the user's own systemd session, got %+v", start.Opts)
	}
	if !run.ran("docker info >/dev/null") {
		t.Error("it should wait for the daemon to actually answer before copying")
	}
}

func TestSwitchInstanceOnlyOnce(t *testing.T) {
	composeDir := t.TempDir()
	stateDir := composeDir + "/.rootful-migration"
	if err := os.MkdirAll(stateDir, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(stateDir+"/instance-switched", nil, 0o644); err != nil {
		t.Fatal(err)
	}

	run := newFakeRunner()
	if err := installer.SwitchInstance(run, composeDir, stateDir); err != nil {
		t.Fatal(err)
	}
	if len(run.calls) != 0 {
		t.Errorf("a second run must not queue every redeploy again, ran %v", run.commands())
	}
}

func TestStopAllWithNothingRunning(t *testing.T) {
	run := newFakeRunner()
	if err := installer.StopAll(run, installer.Opts{}); err != nil {
		t.Fatal(err)
	}
	if run.ran("docker stop") {
		t.Error("nothing running means nothing to stop")
	}
}

func TestMigrationHostPrefersDomainThenComposeThenConfig(t *testing.T) {
	composeDir := t.TempDir()
	resolveCalled := false
	params := installer.MigrationParams{
		ResolveHost: func() (string, error) {
			resolveCalled = true
			return "detected.example.com", nil
		},
	}

	params.Domain = "flag.example.com"
	if host, _ := installer.MigrationHost(params, composeDir); host != "flag.example.com" {
		t.Errorf("--domain= should win, got %q", host)
	}

	params.Domain = ""
	if err := os.WriteFile(
		composeDir+"/compose.yaml",
		[]byte("ORIGIN: ${ORIGIN:-http://compose.example.com:3000}"),
		0o644,
	); err != nil {
		t.Fatal(err)
	}
	if host, _ := installer.MigrationHost(params, composeDir); host != "compose.example.com" {
		t.Errorf("the old compose file's ORIGIN should be next, got %q", host)
	}

	if err := os.Remove(composeDir + "/compose.yaml"); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(composeDir+"/homerun.yaml", []byte("baseDomain: config.example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if host, _ := installer.MigrationHost(params, composeDir); host != "config.example.com" {
		t.Errorf("homerun.yaml's baseDomain should be next, got %q", host)
	}

	if err := os.Remove(composeDir + "/homerun.yaml"); err != nil {
		t.Fatal(err)
	}
	host, err := installer.MigrationHost(params, composeDir)
	if err != nil || host != "detected.example.com" {
		t.Errorf("detection is the last resort, got %q %v", host, err)
	}
	if !resolveCalled {
		t.Error("the fallback should actually have been consulted")
	}
}
