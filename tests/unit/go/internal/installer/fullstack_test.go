package installer_test

import (
	"os"
	"strings"
	"testing"

	"github.com/orochibraru/homerun/internal/installer"
)

func TestFullStackComposeShape(t *testing.T) {
	compose := installer.FullStackCompose("docker.io/orochibraru/homerun:v1.2.3", "/var/run/docker.sock", "homerun.example.com", false)

	for _, fragment := range []string{
		"image: docker.io/orochibraru/homerun:v1.2.3",
		"ORIGIN: ${ORIGIN:-http://homerun.example.com:3000}",
		"postgres-data:/var/lib/postgresql",
		"traefik.http.routers.homerun.tls.certresolver=${DASHBOARD_CERT_RESOLVER:-letsencrypt}",
		"- /var/run/docker.sock:/var/run/docker.sock:ro",
	} {
		if !strings.Contains(compose, fragment) {
			t.Errorf("compose is missing %q", fragment)
		}
	}
	if strings.Contains(compose, "/var/lib/postgresql/data") {
		t.Error("postgres:18 refuses to start against a mount at the old flat data path")
	}
	if !strings.Contains(compose, `AUTH_SECRET: "${AUTH_SECRET:?`) {
		t.Error("the AUTH_SECRET expression must stay quoted, or compose reads its message as YAML")
	}
	if strings.Contains(compose, "providers.swarm") {
		t.Error("a non-swarm install should not configure Traefik's swarm provider")
	}
}

func TestFullStackComposeAppTalksToTheWorkerInsteadOfTheSocket(t *testing.T) {
	compose := installer.FullStackCompose("img", "/run/user/1000/docker.sock", "homerun.example.com", false)
	app := compose[strings.Index(compose, "  app:"):strings.Index(compose, "  worker:")]

	for _, fragment := range []string{
		"WORKER_URL: ${WORKER_URL:-http://worker:7430}",
		"WORKER_TOKEN: ${WORKER_TOKEN:-}",
	} {
		if !strings.Contains(app, fragment) {
			t.Errorf("app service is missing %q:\n%s", fragment, app)
		}
	}
	if strings.Contains(app, "docker.sock") {
		t.Errorf("the app makes no Docker calls of its own, only the worker holds the socket:\n%s", app)
	}
	if strings.Contains(app, "DOCKER_SOCKET_PATH") {
		t.Errorf("DOCKER_SOCKET_PATH is the worker's, the app reads socketPath from homerun.yaml:\n%s", app)
	}
}

func TestFullStackComposeRunsTheWorkerFromTheAppImage(t *testing.T) {
	compose := installer.FullStackCompose("docker.io/orochibraru/homerun:1.2.3", "/run/user/1000/docker.sock", "example.com", false)
	worker := compose[strings.Index(compose, "  worker:"):strings.Index(compose, "  traefik:")]
	for _, fragment := range []string{
		"image: docker.io/orochibraru/homerun:1.2.3",
		`command: ["/usr/local/bin/homerun-worker"]`,
		`AUTH_SECRET: "${AUTH_SECRET:?`,
		"DOCKER_SOCKET_PATH: /run/user/1000/docker.sock",
		"- /run/user/1000/docker.sock:/run/user/1000/docker.sock",
		"WORKER_PORT: ${WORKER_PORT:-7430}",
		"WORKER_TOKEN: ${WORKER_TOKEN:-}",
		"expose:\n      - \"${WORKER_PORT:-7430}\"",
		"homerun.role=worker",
		"disable: true",
	} {
		if !strings.Contains(worker, fragment) {
			t.Errorf("worker service is missing %q:\n%s", fragment, worker)
		}
	}
}

func TestFullStackComposeBareIPHasNoCertResolver(t *testing.T) {
	compose := installer.FullStackCompose("img", "/var/run/docker.sock", "203.0.113.10", false)
	if !strings.Contains(compose, "certresolver=${DASHBOARD_CERT_RESOLVER:-}") {
		t.Error("ACME can't issue for a bare IP, so the resolver must be left blank")
	}
	if !strings.Contains(compose, "ORIGIN: ${ORIGIN:-http://203.0.113.10:3000}") {
		t.Error("the IP should still be the ORIGIN default, never localhost")
	}
}

func TestFullStackComposeSwarm(t *testing.T) {
	compose := installer.FullStackCompose("img", "/var/run/docker.sock", "homerun.example.com", true)
	for _, fragment := range []string{
		"--providers.swarm=true",
		"--providers.swarm.network=homerun-swarm",
		"  homerun-swarm:\n    name: homerun-swarm\n    external: true",
	} {
		if !strings.Contains(compose, fragment) {
			t.Errorf("a swarm install is missing %q", fragment)
		}
	}
}

func TestFullStackComposeMountsTraefikSocketAtTheConventionalPath(t *testing.T) {
	compose := installer.FullStackCompose("img", "/run/user/1000/docker.sock", "homerun.example.com", false)
	if !strings.Contains(compose, "- /run/user/1000/docker.sock:/var/run/docker.sock:ro") {
		t.Error("Traefik's docker provider defaults to /var/run/docker.sock inside its own container")
	}
	if !strings.Contains(compose, "- /run/user/1000/docker.sock:/run/user/1000/docker.sock") {
		t.Error("the worker's own mount keeps the host path, which is what homerun.yaml points at")
	}
}

func TestEnsureAuthSecretGeneratesOnceAndTightensPermissions(t *testing.T) {
	composeDir := t.TempDir()
	run := newFakeRunner()

	if err := installer.EnsureAuthSecret(run, "homerun", composeDir); err != nil {
		t.Fatal(err)
	}
	lines := run.appends[composeDir+"/.env"]
	if len(lines) != 1 || !strings.HasPrefix(lines[0], "AUTH_SECRET=") {
		t.Fatalf("expected one AUTH_SECRET line, got %v", lines)
	}
	secret := strings.TrimPrefix(lines[0], "AUTH_SECRET=")
	if len(secret) != 64 {
		t.Errorf("want 32 random bytes as hex, got %d characters", len(secret))
	}
	if !run.ran("chmod 600") || !run.ran("chown homerun:homerun") {
		t.Errorf("the secret file should be locked down, ran %v", run.commands())
	}

	if err := os.WriteFile(composeDir+"/.env", []byte("AUTH_SECRET=existing\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	run = newFakeRunner()
	if err := installer.EnsureAuthSecret(run, "homerun", composeDir); err != nil {
		t.Fatal(err)
	}
	if len(run.appends) != 0 {
		t.Errorf("an existing secret must never be overwritten, appended %v", run.appends)
	}
}

func TestEnsureAuthSecretIgnoresAnUnrelatedEnvFile(t *testing.T) {
	composeDir := t.TempDir()
	if err := os.WriteFile(composeDir+"/.env", []byte("POSTGRES_USER=homerun\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	run := newFakeRunner()
	if err := installer.EnsureAuthSecret(run, "homerun", composeDir); err != nil {
		t.Fatal(err)
	}
	if len(run.appends[composeDir+"/.env"]) != 1 {
		t.Error("an .env without AUTH_SECRET should still get one")
	}
}

func TestEnsureConfigFileNeverClobbers(t *testing.T) {
	dir := t.TempDir()
	configPath := dir + "/homerun.yaml"
	run := newFakeRunner()

	if err := installer.EnsureConfigFile(run, configPath, "/var/run/docker.sock", "homerun.example.com"); err != nil {
		t.Fatal(err)
	}
	config := run.writes[configPath]
	for _, fragment := range []string{
		"baseDomain: homerun.example.com",
		"socketPath: /var/run/docker.sock",
		"networkName: homerun",
	} {
		if !strings.Contains(config, fragment) {
			t.Errorf("config is missing %q:\n%s", fragment, config)
		}
	}
	if strings.Contains(config, "auth:") {
		t.Error("auth.origin is deliberately absent, the compose file's ORIGIN is the one source")
	}

	if err := os.WriteFile(configPath, []byte("baseDomain: kept.example.com\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	run = newFakeRunner()
	if err := installer.EnsureConfigFile(run, configPath, "/var/run/docker.sock", "other.example.com"); err != nil {
		t.Fatal(err)
	}
	if len(run.writes) != 0 {
		t.Errorf("an existing config must be left alone, wrote %v", run.writes)
	}
}

func TestBringUpFullStackRootless(t *testing.T) {
	home := withHomeRoot(t, "homerun")
	sysctl := t.TempDir() + "/ports.conf"
	original := installer.SysctlConfPath
	installer.SysctlConfPath = sysctl
	t.Cleanup(func() { installer.SysctlConfPath = original })

	run := newFakeRunner()
	composePath, err := installer.BringUpFullStack(installer.FullStackParams{
		DockerSocket: "/run/user/1000/docker.sock",
		Host:         "homerun.example.com",
		Run:          run,
		Username:     "homerun",
		Version:      "v1.2.3",
	})
	if err != nil {
		t.Fatal(err)
	}
	if composePath != home+"/homerun/compose.yaml" {
		t.Errorf("got %q", composePath)
	}
	if run.writes[sysctl] != "net.ipv4.ip_unprivileged_port_start=80\n" {
		t.Error("rootless Docker can't publish 80/443 without lowering the unprivileged port start")
	}
	if !run.ran("sysctl -p") {
		t.Error("the sysctl should also apply to the running system, not just after a reboot")
	}
	up := run.callFor(t, "compose -f "+composePath+" up -d")
	if up.Opts.As != "homerun" {
		t.Errorf("a rootless stack runs as its user, got %q", up.Opts.As)
	}
	if up.Opts.Env["DOCKER_HOST"] != "unix:///run/user/1000/docker.sock" {
		t.Errorf("got %v", up.Opts.Env)
	}
	if up.Opts.Cwd != home+"/homerun" {
		t.Errorf("compose should run from its own directory, got %q", up.Opts.Cwd)
	}
	if strings.Contains(strings.Join(run.callFor(t, "compose -f "+composePath+" pull").Cmd, " "), "--ignore-pull-failures") {
		t.Error("only an --image= install tolerates a failed pull")
	}
}

func TestBringUpFullStackRootful(t *testing.T) {
	withHomeRoot(t, "homerun")
	run := newFakeRunner()

	if _, err := installer.BringUpFullStack(installer.FullStackParams{
		DockerSocket: installer.SystemDockerSocket,
		Host:         "homerun.example.com",
		Image:        "local/homerun:dev",
		Rootful:      true,
		Run:          run,
		Swarm:        true,
		Username:     "homerun",
		Version:      "v1.2.3",
	}); err != nil {
		t.Fatal(err)
	}
	up := run.callFor(t, "up -d")
	if up.Opts.As != "" {
		t.Errorf("a rootful stack runs as root, got As=%q", up.Opts.As)
	}
	pull := run.callFor(t, "pull")
	if !strings.Contains(strings.Join(pull.Cmd, " "), "--ignore-pull-failures") {
		t.Error("--image= may only exist locally, so its pull must be allowed to fail")
	}
	for path, content := range run.writes {
		if strings.HasSuffix(path, "compose.yaml") && !strings.Contains(content, "image: local/homerun:dev") {
			t.Error("--image= should replace the release image")
		}
	}
	if run.ran("sysctl -p") {
		t.Error("a rootful install has no unprivileged-port problem to work around")
	}
}
