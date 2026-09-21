package installer

import (
	"crypto/rand"
	_ "embed"
	"encoding/hex"
	"fmt"
	"maps"
	"os"
	"regexp"
	"slices"
	"strings"

	"github.com/orochibraru/homerun/internal/release"
)

// SysctlConfPath is where the unprivileged-port sysctl is persisted. A variable
// so tests can point it at a scratch file.
var SysctlConfPath = "/etc/sysctl.d/90-homerun-rootless-ports.conf"

// bareIP matches a host that is an IPv4 literal, which ACME can't issue for.
var bareIP = regexp.MustCompile(`^[0-9.]+$`)

// FullStackParams is everything --mode=full needs to bring the stack up.
type FullStackParams struct {
	// DockerSocket is the daemon the stack runs on.
	DockerSocket string
	// Host is the domain or IP this instance will be reached at, never
	// localhost: see FullStackCompose's doc comment.
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
// app itself + the homerun-worker container running from the same image, all as
// pulled images) on the daemon the installer set up, the
// system one as root or the rootless one as Username, with the files under that
// user's home either way.
//
// Returns the compose file path it wrote, for the "how to check on it" hint
// printed at the end.
func BringUpFullStack(params FullStackParams) (string, error) {
	run := params.Run
	composeDir := HomeOf(params.Username) + "/homerun"
	composePath := composeDir + "/compose.yaml"
	configPath := composeDir + "/homerun.yaml"

	dockerUser := Opts{Env: map[string]string{"DOCKER_HOST": "unix://" + params.DockerSocket}}
	if !params.Rootful {
		dockerUser.As = params.Username
		dockerUser.Env["HOME"] = HomeOf(params.Username)
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
	if err := EnsureConfigFile(run, configPath, params.DockerSocket, params.Host); err != nil {
		return "", err
	}
	image := params.Image
	if image == "" {
		image = release.ImageRef(params.Version)
	}
	if err := SetEnvValues(run, composeDir+"/.env", ComposeEnv(image, params.DockerSocket, params.Host)); err != nil {
		return "", err
	}
	if err := run.WriteFile(composePath, ComposeFile); err != nil {
		return "", err
	}
	composeFiles := []string{"-f", composePath}
	if params.Swarm {
		swarmPath := composeDir + "/compose.swarm.yaml"
		if err := run.WriteFile(swarmPath, ComposeSwarmFile); err != nil {
			return "", err
		}
		composeFiles = append(composeFiles, "-f", swarmPath)
	}
	if _, err := run.Run(
		[]string{"chown", "-R", params.Username + ":" + params.Username, composeDir},
		Opts{},
	); err != nil {
		return "", err
	}

	pull := append(append([]string{"docker", "compose"}, composeFiles...), "pull", "--quiet")
	if params.Image != "" {
		pull = append(pull, "--ignore-pull-failures")
	}
	pullOpts := dockerUser
	pullOpts.Cwd = composeDir
	if _, err := run.Run(pull, pullOpts); err != nil {
		return "", err
	}
	if _, err := run.Run(append(append([]string{"docker", "compose"}, composeFiles...), "up", "-d"), pullOpts); err != nil {
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
	if err := run.WriteFile(SysctlConfPath, "net.ipv4.ip_unprivileged_port_start=80\n"); err != nil {
		return err
	}
	_, err := run.Run([]string{"sysctl", "-p", SysctlConfPath}, Opts{})
	return err
}

// EnsureConfigFile writes homerun.yaml once, same "never clobber an existing
// value" rule as EnsureAuthSecret's own .env. auth.origin is deliberately
// absent: config.ts falls back to the ORIGIN env var the compose file sets, so
// there's one place to change it rather than two that can disagree.
func EnsureConfigFile(run Runner, configPath, dockerSocket, host string) error {
	if FileExists(configPath) {
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
// permissions afterward" shape as the agent-mode worker's own token: docker compose
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

// ComposeFile is the generated compose file every install and self-update
// writes, the same file the app image ships at /app/compose/compose.yaml. It is
// static: everything that differs per host lives in .env (see ComposeEnv), so
// an update can overwrite it wholesale. Its shape carries five real,
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
//     path; and DOCKER_SOCKET_PATH is passed to the worker so its entrypoint's
//     socket group fixup actually finds the socket.
//
//go:embed compose.yaml
var ComposeFile string

// ComposeSwarmFile is the overlay a swarm install adds on top of ComposeFile:
// Traefik's swarm provider and its attachment to the swarm overlay network.
//
//go:embed compose.swarm.yaml
var ComposeSwarmFile string

// ComposeEnv is everything per-host the static compose file reads from .env.
// The cert resolver is left blank for a bare IP (ACME can't issue for one, and
// asking it to is a hard error in Traefik's log every refresh), so an IP
// install gets the router with Traefik's own self-signed cert and a --domain=
// install gets a real certificate.
func ComposeEnv(image, dockerSocket, host string) map[string]string {
	repository, tag := splitImage(image)
	resolver := "letsencrypt"
	if bareIP.MatchString(host) {
		resolver = ""
	}
	return map[string]string{
		"DASHBOARD_CERT_RESOLVER": resolver,
		"HOMERUN_DOCKER_SOCKET":   dockerSocket,
		"HOMERUN_HOST":            host,
		"HOMERUN_IMAGE":           repository,
		"HOMERUN_VERSION":         tag,
	}
}

// splitImage splits an image reference into repository and tag, defaulting
// the tag to latest.
func splitImage(image string) (string, string) {
	colon := strings.LastIndex(image, ":")
	if colon == -1 || colon < strings.LastIndex(image, "/") {
		return image, "latest"
	}
	return image[:colon], image[colon+1:]
}

// SetEnvValues writes values into the .env at envPath, replacing a key's
// existing line and appending the ones it doesn't have yet, leaving every
// other line (AUTH_SECRET, the admin's own settings) untouched.
func SetEnvValues(run Runner, envPath string, values map[string]string) error {
	existing, err := os.ReadFile(envPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	pending := maps.Clone(values)
	var lines []string
	for _, line := range strings.Split(strings.TrimRight(string(existing), "\n"), "\n") {
		key, _, found := strings.Cut(line, "=")
		if value, ok := pending[strings.TrimSpace(key)]; found && ok {
			line = strings.TrimSpace(key) + "=" + value
			delete(pending, strings.TrimSpace(key))
		}
		if line != "" || len(lines) > 0 {
			lines = append(lines, line)
		}
	}
	for _, key := range slices.Sorted(maps.Keys(pending)) {
		lines = append(lines, key+"="+pending[key])
	}
	return run.WriteFile(envPath, strings.Join(lines, "\n")+"\n")
}
