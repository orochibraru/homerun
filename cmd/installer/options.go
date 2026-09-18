package main

import (
	"fmt"
	"strconv"
	"strings"
)

// InstallMode is what an install sets up: just the agent, or the full stack.
type InstallMode string

// DockerFlavour is which daemon the stack runs on.
type DockerFlavour string

const (
	// ModeAgent installs just the Homerun Agent, for a host that only receives
	// migrated or placed workloads.
	ModeAgent InstallMode = "agent"
	// ModeFull also brings up the main app, Traefik and Postgres via a generated
	// docker compose file.
	ModeFull InstallMode = "full"

	// FlavourRootful is the system daemon, set up as a swarm manager.
	FlavourRootful DockerFlavour = "rootful"
	// FlavourRootless is a per-user daemon, standalone only, since rootless
	// Docker can't create overlay networks.
	FlavourRootless DockerFlavour = "rootless"
)

// Options is the installer's resolved configuration for one run.
type Options struct {
	// AdvertiseAddress is what `docker swarm init` advertises to other nodes
	// (rootful --mode=full), detected from the default route when unset.
	AdvertiseAddress string
	// AgentPort is the agent's HTTP port.
	AgentPort int
	// Docker is which daemon --mode=full runs the stack on, empty meaning the
	// default (see DockerFlavourOf).
	Docker DockerFlavour
	// Domain is the domain or IP this instance will be reached at (--mode=full):
	// it becomes the app's baseDomain and its ORIGIN. Prompted for, or detected
	// from this host's own address, when not given: it must never end up as
	// localhost, see fullstack.go.
	Domain string
	// DryRun prints every command instead of running it: the only way this
	// installer's logic gets exercised in review/CI without root or a
	// disposable VM.
	DryRun bool
	// Image is an app image to run instead of the release's
	// docker.io/orochibraru/homerun:<version>, e.g. a locally loaded build.
	Image string
	// MigrateToRootful moves an existing rootless --mode=full install onto the
	// system daemon in swarm mode, see migrate.go.
	MigrateToRootful bool
	// Mode is which of the two installs to perform.
	Mode InstallMode
	// RootlessUser is the rootless-Docker system user to create, or reuse if it
	// already exists.
	RootlessUser string
	// Version is which release to install from, "latest" or a tag like "v1.2.3".
	Version string
	// Yes skips the "here's what I'm about to do, continue?" prompt, required
	// for a non-interactive curl | sh install.
	Yes bool
}

// defaultOptions is the starting point every run parses its flags over.
func defaultOptions() Options {
	return Options{
		AgentPort:    7420,
		Mode:         ModeAgent,
		RootlessUser: "homerun",
		Version:      "latest",
	}
}

// DockerFlavourOf is the daemon an install actually uses: the agent always gets
// its own rootless one, --mode=full defaults to the system daemon.
func DockerFlavourOf(opts Options) DockerFlavour {
	if opts.Mode == ModeAgent {
		return FlavourRootless
	}
	if opts.Docker == "" {
		return FlavourRootful
	}
	return opts.Docker
}

// ParseArgs parses installer flags over the defaults.
//
// The second return value is a request to print help and exit 0; the error is
// an unknown argument or an unparseable value.
func ParseArgs(argv []string) (Options, bool, error) {
	opts := defaultOptions()
	for _, arg := range argv {
		switch arg {
		case "--help", "-h":
			return opts, true, nil
		case "--docker=rootful":
			opts.Docker = FlavourRootful
			continue
		case "--docker=rootless":
			opts.Docker = FlavourRootless
			continue
		case "--dry-run":
			opts.DryRun = true
			continue
		case "--migrate-to-rootful":
			opts.MigrateToRootful = true
			opts.Mode = ModeFull
			continue
		case "--mode=agent":
			opts.Mode = ModeAgent
			continue
		case "--mode=full":
			opts.Mode = ModeFull
			continue
		case "--yes", "-y":
			opts.Yes = true
			continue
		}

		switch {
		case strings.HasPrefix(arg, "--advertise-addr="):
			opts.AdvertiseAddress = strings.TrimPrefix(arg, "--advertise-addr=")
		case strings.HasPrefix(arg, "--port="):
			port, err := strconv.Atoi(strings.TrimPrefix(arg, "--port="))
			if err != nil {
				return opts, false, fmt.Errorf("--port= needs a number, got %q", strings.TrimPrefix(arg, "--port="))
			}
			opts.AgentPort = port
		case strings.HasPrefix(arg, "--domain="):
			opts.Domain = strings.TrimPrefix(arg, "--domain=")
		case strings.HasPrefix(arg, "--image="):
			opts.Image = strings.TrimPrefix(arg, "--image=")
		case strings.HasPrefix(arg, "--user="):
			opts.RootlessUser = strings.TrimPrefix(arg, "--user=")
		case strings.HasPrefix(arg, "--version="):
			opts.Version = strings.TrimPrefix(arg, "--version=")
		default:
			return opts, false, fmt.Errorf("Unknown argument: %s (see --help)", arg)
		}
	}
	return opts, false, nil
}

// Validate makes the cross-flag checks the per-token parser can't.
//
// It returns an error message, or the empty string when the combination is valid.
func Validate(opts Options) string {
	if opts.Docker != "" && opts.Mode != ModeFull {
		return fmt.Sprintf(
			"--docker=%s only applies to --mode=full : the agent always runs on its own rootless daemon.",
			opts.Docker,
		)
	}
	if opts.MigrateToRootful && opts.Docker == FlavourRootless {
		return "--migrate-to-rootful moves an install onto the system daemon : drop --docker=rootless."
	}
	if opts.AdvertiseAddress != "" && DockerFlavourOf(opts) != FlavourRootful {
		return "--advertise-addr only applies to a rootful --mode=full install, the only kind that runs a swarm."
	}
	return ""
}

// helpText is the installer's usage and flag reference.
const helpText = `
homerun-install : sets up Docker, then the Homerun Agent or the full stack,
on a fresh Linux server, entirely from prebuilt release binaries and Docker
images, nothing built from source.

Usage:
  homerun-install [options]

Options:
  --version=<tag>     Release to install from : "latest" (default) or a tag
                       like "v1.2.3". Selects the agent/installer/cli
                       binaries fetched from GitHub releases.
  --mode=agent|full   agent = just the Homerun Agent (default), on a
                              rootless daemon
                      full  = also brings up the main app via docker compose
  --domain=<host>     Domain or IP the instance is reached at (--mode=full).
                      Prompted for, or detected from this host's own address,
                      when omitted. Never defaults to localhost.
  --docker=rootless|rootful
                      Daemon --mode=full runs the stack on (default: rootful).
                      rootful = the system daemon (runs as root), initialised
                                as a swarm manager : the instance starts in
                                swarm mode
                      rootless = a per-user daemon, standalone mode only
  --advertise-addr=<ip>
                      Address the swarm advertises to other nodes (rootful
                      --mode=full). Default: this host's default-route address.
  --migrate-to-rootful
                      Move an existing rootless --mode=full install onto the
                      system daemon in swarm mode : copies every volume, keeps
                      .env and homerun.yaml, redeploys every service. Safe to
                      re-run after a failure.
  --image=<ref>       App image to run instead of the release's
                      docker.io/orochibraru/homerun:<version>
  --user=<name>       System user owning the install (default: homerun)
  --port=<n>          Agent HTTP port (default: 7420)
  --dry-run           Print every command instead of running it
  --yes, -y            Skip the confirmation prompt (needed for curl | sh)
`
