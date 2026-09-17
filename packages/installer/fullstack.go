package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"os"
	"regexp"
	"strings"
)

// sysctlConfPath is where the unprivileged-port sysctl is persisted. A variable
// so tests can point it at a scratch file.
var sysctlConfPath = "/etc/sysctl.d/90-homerun-rootless-ports.conf"

// bareIP matches a host that is an IPv4 literal, which ACME can't issue for.
var bareIP = regexp.MustCompile(`^[0-9.]+$`)

// FullStackParams is everything --mode=full needs to bring the stack up.
type FullStackParams struct {
	// DockerSocket is the daemon the stack runs on.
	DockerSocket string
	// Host is the domain or IP this instance will be reached at, never
	// localhost: see fullStackCompose's doc comment.
	Host string
	// Image replaces the release image (--image=); its pull may fail when it
	// only exists locally.
	Image string
	// Rootful runs compose as root against the system daemon instead of as
	// Username against its rootless one (--docker=rootful).
	Rootful bool
	Run     Runner
	// Swarm turns on Traefik's swarm provider and attaches it to the swarm
	// overlay (a rootful install, whose daemon the installer made a manager).
	Swarm    bool
	Username string
	Version  string
}

// BringUpFullStack brings up the actual Homerun app (Traefik + Postgres + the
// app itself, all as pulled images) on the daemon the installer set up, the
// system one as root or the rootless one as Username, with the files under that
// user's home either way.
//
// Returns the compose file path it wrote, for the "how to check on it" hint
// printed at the end.
func BringUpFullStack(params FullStackParams) (string, error) {
	run := params.Run
	composeDir := homeOf(params.Username) + "/homerun"
	composePath := composeDir + "/compose.yaml"
	configPath := composeDir + "/homerun.yaml"

	dockerUser := Opts{Env: map[string]string{"DOCKER_HOST": "unix://" + params.DockerSocket}}
	if !params.Rootful {
		dockerUser.As = params.Username
		dockerUser.Env["HOME"] = homeOf(params.Username)
	}

	if _, err := run.Run([]string{"mkdir", "-p", composeDir}, Opts{As: params.Username}); err != nil {
		return "", err
	}
	if !params.Rootful {
		if err := allowPrivilegedPorts(run); err != nil {
			return "", err
		}
	}
	if err := EnsureAuthSecret(run, params.Username, composeDir); err != nil {
		return "", err
	}
	if err := ensureConfigFile(run, configPath, params.DockerSocket, params.Host); err != nil {
		return "", err
	}
	image := params.Image
	if image == "" {
		image = ImageRef(params.Version)
	}
	if err := run.WriteFile(
		composePath,
		fullStackCompose(image, params.DockerSocket, params.Host, params.Swarm),
	); err != nil {
		return "", err
	}
	if _, err := run.Run(
		[]string{"chown", "-R", params.Username + ":" + params.Username, composeDir},
		Opts{},
	); err != nil {
		return "", err
	}

	pull := []string{"docker", "compose", "-f", composePath, "pull", "--quiet"}
	if params.Image != "" {
		pull = append(pull, "--ignore-pull-failures")
	}
	pullOpts := dockerUser
	pullOpts.Cwd = composeDir
	if _, err := run.Run(pull, pullOpts); err != nil {
		return "", err
	}
	if _, err := run.Run([]string{"docker", "compose", "-f", composePath, "up", "-d"}, pullOpts); err != nil {
		return "", err
	}
	return composePath, nil
}

// allowPrivilegedPorts lets rootless Docker publish 80/443.
//
// Real, tested-live finding (--mode=full against a real disposable Multipass
// Ubuntu 24.04 VM): rootless Docker's RootlessKit port driver refuses to bind
// ports below 1024 by default (Linux's own unprivileged-port restriction, not a
// Docker bug), so Traefik's 80/443 publish failed outright with "cannot expose
// privileged port 80, ... bind: permission denied" the first time this ran for
// real, and `docker compose up` never got the stack running at all. This is
// Docker's own documented fix for exactly this case: lower
// net.ipv4.ip_unprivileged_port_start so any user can bind >=80. Written
// persistently (survives reboot, /etc/sysctl.d/) and applied immediately via
// `sysctl -p` so this run doesn't also need one.
func allowPrivilegedPorts(run Runner) error {
	if err := run.WriteFile(sysctlConfPath, "net.ipv4.ip_unprivileged_port_start=80\n"); err != nil {
		return err
	}
	_, err := run.Run([]string{"sysctl", "-p", sysctlConfPath}, Opts{})
	return err
}

// ensureConfigFile writes homerun.yaml once, same "never clobber an existing
// value" rule as EnsureAuthSecret's own .env. auth.origin is deliberately
// absent: config.ts falls back to the ORIGIN env var the compose file sets, so
// there's one place to change it rather than two that can disagree.
func ensureConfigFile(run Runner, configPath, dockerSocket, host string) error {
	if fileExists(configPath) {
		return nil
	}
	return run.WriteFile(configPath, fmt.Sprintf(`baseDomain: %s
docker:
  networkName: homerun
  socketPath: %s
traefik:
  dynamicConfigDir: /app/traefik-dynamic
`, host, dockerSocket))
}

// EnsureAuthSecret generates AUTH_SECRET once and persists it to .env next to
// the compose file, the same "generate once, remember it, tighten the
// permissions afterward" shape as the Homerun Agent's own token: docker compose
// reads a .env file next to its compose.yaml automatically, so nothing else has
// to change for the app service's existing AUTH_SECRET: ${AUTH_SECRET:?...} to
// pick it up. A value already present in .env, generated by a prior run or set
// by the admin, always wins; this never overwrites one.
func EnsureAuthSecret(run Runner, username, composeDir string) error {
	envPath := composeDir + "/.env"
	if hasAuthSecret(envPath) {
		return nil
	}
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return err
	}
	if err := run.AppendLine(envPath, "AUTH_SECRET="+hex.EncodeToString(buffer)); err != nil {
		return err
	}
	if _, err := run.Run([]string{"chmod", "600", envPath}, Opts{}); err != nil {
		return err
	}
	_, err := run.Run([]string{"chown", username + ":" + username, envPath}, Opts{})
	return err
}

// hasAuthSecret reports whether the env file exists and already has an
// AUTH_SECRET= line.
func hasAuthSecret(envPath string) bool {
	content, err := os.ReadFile(envPath)
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(content), "\n") {
		if strings.HasPrefix(strings.TrimSpace(line), "AUTH_SECRET=") {
			return true
		}
	}
	return false
}

// fullStackCompose is the generated compose file. Its shape carries five real,
// tested-live findings, each of which broke a real install:
//
//  1. The AUTH_SECRET line's ${VAR:?message} error message originally contained
//     " : ", and `docker compose pull` failed with a YAML "mapping values are
//     not allowed in this context" error, since an unquoted scalar containing
//     colon+space starts a nested mapping. Fixed by quoting the whole ${...}
//     expression and rewording the message.
//  2. postgres's volume originally mounted at /var/lib/postgresql/data, which
//     postgres:18-alpine refuses to start against: 18+ expects the
//     /var/lib/postgresql parent instead and exits immediately, failing the
//     healthcheck and therefore the whole `docker compose up`.
//  3. ORIGIN was never set, so the app's server fell back to
//     http://localhost:3000 regardless of the real address, and `homerun login`
//     printed a localhost approval link to remote users.
//  4. That default is not localhost, because a localhost ORIGIN makes the very
//     first sign-up 403 with better-auth's "Invalid origin": SvelteKit
//     normalizes event.url to ORIGIN, so trusted origins are derived from it
//     rather than from the address the browser actually used.
//  5. Traefik's socket is mounted at the container-side conventional path
//     (/var/run/docker.sock) rather than the host's rootless path, since
//     Traefik's docker provider reads no homerun.yaml and defaults to that
//     path; and DOCKER_SOCKET_PATH is passed to the app so its entrypoint's
//     socket group fixup actually finds the socket.
//
// The cert resolver is left blank for a bare IP (ACME can't issue for one, and
// asking it to is a hard error in Traefik's log every refresh), so an IP
// install gets the router with Traefik's own self-signed cert and a --domain=
// install gets a real certificate.
func fullStackCompose(image, dockerSocket, host string, swarm bool) string {
	dashboardResolver := "letsencrypt"
	if bareIP.MatchString(host) {
		dashboardResolver = ""
	}
	swarmFlags := ""
	traefikSwarmNetwork := ""
	swarmNetworkDefinition := ""
	if swarm {
		swarmFlags = fmt.Sprintf(`
      - --providers.swarm=true
      - --providers.swarm.exposedByDefault=false
      - --providers.swarm.network=%s
      - --providers.swarm.refreshSeconds=2`, SwarmNetwork)
		traefikSwarmNetwork = fmt.Sprintf(`
      - %s`, SwarmNetwork)
		swarmNetworkDefinition = fmt.Sprintf(`
  %s:
    name: %s
    external: true`, SwarmNetwork, SwarmNetwork)
	}

	return fmt.Sprintf(`# Generated by the Homerun installer (--mode=full). Every image below is
# pulled, not built, re-run `+"`docker compose -f compose.yaml pull && ...up -d`"+`
# here to update. Edit homerun.yaml next to this file for baseDomain/docker/etc
# and ORIGIN in .env if this instance moves to another address,
# AUTH_SECRET is auto-generated into .env (EnsureAuthSecret).
services:
  app:
    image: %s
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://${POSTGRES_USER:-homerun}:${POSTGRES_PASSWORD:-homerun}@postgres:5432/${POSTGRES_DB:-homerun}
      AUTH_SECRET: "${AUTH_SECRET:?missing from .env - the installer generates this automatically, set it yourself only if running this compose file standalone, e.g. openssl rand -hex 32}"
      ORIGIN: ${ORIGIN:-http://%s:3000}
      DOCKER_SOCKET_PATH: %s
      TRAEFIK_DYNAMIC_CONFIG_DIR: /app/traefik-dynamic
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.homerun.rule=Host(`+"`"+`${DASHBOARD_DOMAIN:-%s}`+"`"+`)"
      - "traefik.http.routers.homerun.entrypoints=${DASHBOARD_ENTRYPOINT:-websecure}"
      - "traefik.http.routers.homerun.tls=true"
      - "traefik.http.routers.homerun.tls.certresolver=${DASHBOARD_CERT_RESOLVER:-%s}"
      - "traefik.http.services.homerun.loadbalancer.server.port=3000"
    ports:
      - "3000:3000"
    volumes:
      - %s:%s
      - homerun-data:/app/data
      - traefik-dynamic:/app/traefik-dynamic
      - ./homerun.yaml:/app/homerun.yaml:ro
    networks:
      - homerun
      - default

  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=homerun
      - --providers.file.directory=/etc/traefik/dynamic
      - --providers.file.watch=true
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL:-admin@example.com}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json%s
    extra_hosts:
      - "host.docker.internal:host-gateway"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - %s:/var/run/docker.sock:ro
      - traefik-certs:/letsencrypt
      - traefik-dynamic:/etc/traefik/dynamic
    networks:
      - homerun%s

  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-homerun}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-homerun}
      POSTGRES_USER: ${POSTGRES_USER:-homerun}
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      interval: 5s
      retries: 5
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-homerun}"]
      timeout: 5s

networks:
  homerun:
    name: homerun
    external: true%s

volumes:
  postgres-data: {}
  traefik-certs: {}
  traefik-dynamic: {}
  homerun-data: {}
`,
		image, host, dockerSocket, host, dashboardResolver, dockerSocket, dockerSocket,
		swarmFlags, dockerSocket, traefikSwarmNetwork, swarmNetworkDefinition,
	)
}
