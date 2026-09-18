// Package installer installs Homerun, its agent or a swarm worker onto a Linux host.
package installer

import (
	"bufio"
	"fmt"
	"os"
	"regexp"
	"strings"

	"github.com/orochibraru/homerun/internal/buildinfo"
)

// schemePrefix and trailingSlashes normalise a pasted dashboard URL down to the
// bare host baseDomain wants.
var (
	schemePrefix    = regexp.MustCompile(`^https?://`)
	trailingSlashes = regexp.MustCompile(`/+$`)
)

// stdinIsTTY reports whether there's a human to prompt. A variable so tests can
// force either answer.
var stdinIsTTY = func() bool {
	info, err := os.Stdin.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

// Main runs homerun-installer with the process's own arguments, exiting non-zero on failure.
func Main() {
	opts, wantsHelp, err := ParseArgs(os.Args[1:])
	if wantsHelp {
		fmt.Print(helpText)
		return
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	if invalid := Validate(opts); invalid != "" {
		fmt.Fprintln(os.Stderr, invalid)
		os.Exit(1)
	}
	if err := install(opts); err != nil {
		fmt.Fprintf(os.Stderr, "\ninstaller failed: %s\n", err)
		os.Exit(1)
	}
}

// install runs the whole flow for one set of options.
func install(opts Options) error {
	fmt.Printf("Homerun installer v%s : draft/WIP, see installer/README.md before running against a real box.\n", buildinfo.Version)
	fmt.Println()

	if !opts.DryRun {
		if err := RequireLinux(); err != nil {
			return err
		}
		if err := RequireRoot(); err != nil {
			return err
		}
	}

	arch, err := Arch()
	if err != nil {
		return err
	}
	run := NewStepRunner(opts.DryRun)
	docker := DockerFlavourOf(opts)

	fmt.Printf(
		"Target: mode=%s docker=%s migrate=%t user=%s arch=%s version=%s dryRun=%t\n\n",
		opts.Mode, docker, opts.MigrateToRootful, opts.RootlessUser, arch, opts.Version, opts.DryRun,
	)

	if opts.MigrateToRootful {
		return migrateToRootful(opts, run)
	}

	dockerSocket, host, err := installDocker(opts, run, docker)
	if err != nil {
		return err
	}
	if err := installStack(opts, run, docker, dockerSocket, host, arch); err != nil {
		return err
	}

	fmt.Println("\nDone.")
	printNextSteps(opts, dockerSocket, host)
	return nil
}

// resolveHost is where this instance will actually be reached, in order:
// --domain=, an interactive answer, then this host's own address. Never
// localhost: a localhost ORIGIN makes the very first sign-up 403 with
// better-auth's "Invalid origin" from any browser that isn't on the box (see
// fullstack.go). curl | bash has no TTY on stdin, so that path takes the
// detected address silently rather than hanging on a prompt nobody can answer.
func resolveHost(opts Options) (string, error) {
	if opts.Domain != "" {
		return normalizeHost(opts.Domain), nil
	}
	detected := HostAddress()
	if detected == "" && opts.DryRun {
		detected = "203.0.113.10"
	}
	answer := ""
	if stdinIsTTY() && !opts.Yes {
		answer = promptHost(detected)
	}
	host := answer
	if host == "" {
		host = detected
	}
	if host == "" {
		return "", fmt.Errorf(
			`Could not work out an address for this host : re-run with --domain=<domain or IP>. It must not be localhost, or the first sign-up fails with "Invalid origin".`,
		)
	}
	if answer == "" {
		fmt.Printf("\nUsing %s as this instance's address (--domain=<domain> to override).\n", host)
	}
	return host, nil
}

// promptHost asks for the instance's address. EOF on stdin (Ctrl+D, or a TTY
// whose input closes) is an unanswered prompt, not a failed install, so it falls
// through to the detected address.
func promptHost(detected string) string {
	suffix := ""
	if detected != "" {
		suffix = fmt.Sprintf(" (blank uses this host's address, %s)", detected)
	}
	fmt.Printf("\nDomain this instance will be reached at, e.g. homerun.example.com%s: ", suffix)
	scanner := bufio.NewScanner(os.Stdin)
	if !scanner.Scan() {
		return ""
	}
	return normalizeHost(scanner.Text())
}

// normalizeHost strips a pasted dashboard URL down to the bare host baseDomain
// wants.
func normalizeHost(value string) string {
	trimmed := strings.TrimSpace(value)
	return trailingSlashes.ReplaceAllString(schemePrefix.ReplaceAllString(trimmed, ""), "")
}

// installDocker is steps 1 to 3 of a fresh install: Docker Engine, the install
// user, then the system daemon as a swarm manager or a rootless daemon for that
// user.
//
// Returns the daemon's socket and the instance's address (empty for an agent
// install).
func installDocker(opts Options, run Runner, docker DockerFlavour) (string, string, error) {
	host := ""
	if opts.Mode == ModeFull {
		resolved, err := resolveHost(opts)
		if err != nil {
			return "", "", err
		}
		host = resolved
	}
	rootful := docker == FlavourRootful

	if rootful {
		fmt.Println("\n== 1/5 Docker engine ==")
	} else {
		fmt.Println("\n== 1/5 Docker engine + rootless prerequisites ==")
	}
	if err := InstallDockerEngine(run); err != nil {
		return "", "", err
	}
	if !rootful {
		pm, err := packageManagerFor(opts)
		if err != nil {
			return "", "", err
		}
		if err := InstallRootlessPrereqs(run, pm); err != nil {
			return "", "", err
		}
	}

	if rootful {
		fmt.Println("\n== 2/5 Install user ==")
	} else {
		fmt.Println("\n== 2/5 Rootless user ==")
	}
	if err := EnsureRootlessUser(run, opts.RootlessUser); err != nil {
		return "", "", err
	}

	if !rootful {
		fmt.Println("\n== 3/5 Rootless Docker daemon ==")
		socket, err := InstallRootlessDocker(run, opts.RootlessUser)
		return socket, host, err
	}

	fmt.Println("\n== 3/5 System Docker daemon + swarm manager ==")
	dockerSocket, err := EnableRootfulDocker(run)
	if err != nil {
		return "", "", err
	}
	if err := AddUserToDockerGroup(run, opts.RootlessUser); err != nil {
		return "", "", err
	}
	if err := EnsureSwarmManager(run, advertiseAddressFor(opts)); err != nil {
		return "", "", err
	}
	return dockerSocket, host, nil
}

// packageManagerFor is the host's package manager. --dry-run is also how this
// installer's own logic gets exercised outside a real Debian/RHEL box (e.g.
// from a macOS dev machine), so there it falls back to apt instead of failing
// before anything else runs.
func packageManagerFor(opts Options) (PackageManager, error) {
	pm, err := DetectPackageManager()
	if err == nil {
		return pm, nil
	}
	if opts.DryRun {
		return PackageManager{Install: []string{"apt-get", "install", "-y"}, Kind: "apt"}, nil
	}
	return PackageManager{}, err
}

// installStack is steps 4 and 5 of a fresh install: the networks on the chosen
// daemon, then the agent or the full stack.
func installStack(opts Options, run Runner, docker DockerFlavour, dockerSocket, host, arch string) error {
	rootful := docker == FlavourRootful
	fmt.Println("\n== 4/5 Networks ==")
	networkUser := opts.RootlessUser
	if rootful {
		networkUser = ""
	}
	if err := EnsureHomerunNetwork(run, networkUser, dockerSocket); err != nil {
		return err
	}
	if rootful {
		if err := EnsureOverlayNetwork(run); err != nil {
			return err
		}
	}

	fmt.Println("\n== 5/5 Install ==")
	if opts.Mode == ModeAgent {
		if _, err := InstallAgentBinary(run, opts.Version, arch); err != nil {
			return err
		}
		return InstallAgentSystemdUnit(run, opts.RootlessUser, dockerSocket, opts.AgentPort)
	}
	_, err := BringUpFullStack(FullStackParams{
		DockerSocket: dockerSocket,
		Host:         host,
		Image:        opts.Image,
		Rootful:      rootful,
		Run:          run,
		Swarm:        rootful,
		Username:     opts.RootlessUser,
		Version:      opts.Version,
	})
	return err
}

// advertiseAddressFor is --advertise-addr=, else this host's default-route
// address, else empty to let `docker swarm init` pick.
func advertiseAddressFor(opts Options) string {
	if opts.AdvertiseAddress != "" {
		return opts.AdvertiseAddress
	}
	return HostAddress()
}

// migrateToRootful runs --migrate-to-rootful, then prints what's left for the
// operator.
func migrateToRootful(opts Options, run Runner) error {
	report, err := Migrate(MigrationParams{
		AdvertiseAddress: advertiseAddressFor(opts),
		Domain:           opts.Domain,
		DryRun:           opts.DryRun,
		Image:            opts.Image,
		ResolveHost:      func() (string, error) { return resolveHost(opts) },
		Run:              run,
		Username:         opts.RootlessUser,
		Version:          opts.Version,
	})
	if err != nil {
		return err
	}

	fmt.Println("\nDone. Homerun now runs on the system Docker daemon in swarm mode.")
	fmt.Println("Every deployed service has been queued for a redeploy as a swarm service : follow them on the dashboard's Services page.")
	fmt.Printf("Check the stack with: sudo docker compose -f %s ps\n", report.ComposePath)
	if len(report.OtherContainers) > 0 {
		fmt.Println("\nThese containers weren't created by Homerun and weren't moved, recreate them on the system daemon yourself:")
		for _, container := range report.OtherContainers {
			fmt.Printf("  %s\n", container)
		}
	}
	if len(report.BindMounts) > 0 {
		fmt.Println("\nServices bind-mount these host paths. Files there are still owned by the rootless user's mapped ids, so a container running as a non-root user may need a chown:")
		for _, path := range report.BindMounts {
			fmt.Printf("  %s\n", path)
		}
	}
	home := homeOf(opts.RootlessUser)
	fmt.Printf(`
The rootless daemon is stopped and disabled, its data is untouched. Once you're happy, remove it with:
  sudo -u %s env XDG_RUNTIME_DIR=/run/user/%s %s/bin/dockerd-rootless-setuptool.sh uninstall
  sudo rm -rf %s/.local/share/docker %s/bin
  sudo rm -f %s/homerun/compose.rootless.yaml /etc/sysctl.d/90-homerun-rootless-ports.conf
`, opts.RootlessUser, report.UID, home, home, home, home)
	return nil
}

// printNextSteps tells the operator what to check once the install finishes.
func printNextSteps(opts Options, dockerSocket, host string) {
	home := homeOf(opts.RootlessUser)
	if opts.Mode == ModeAgent {
		fmt.Printf("Homerun Agent should now be listening on port %d.\n", opts.AgentPort)
		fmt.Printf("Its token: sudo -u %s cat %s/.homerun-agent/token\n", opts.RootlessUser, home)
		fmt.Println("Paste that (plus this host's reachable URL) into the main Homerun instance's Remote Hosts page.")
		return
	}
	composePath := home + "/homerun/compose.yaml"
	fmt.Printf("Dashboard: http://%s:3000\n", host)
	fmt.Printf("The full stack should be coming up under %s, check with:\n", composePath)
	asUser := "sudo"
	if DockerFlavourOf(opts) != FlavourRootful {
		asUser = fmt.Sprintf("sudo -u %s env DOCKER_HOST=unix://%s", opts.RootlessUser, dockerSocket)
	}
	fmt.Printf("  %s docker compose -f %s ps\n", asUser, composePath)
	fmt.Printf(
		"AUTH_SECRET was auto-generated into %s/homerun/.env ; if it's not up yet, check the other vars there (ORIGIN, ACME_EMAIL, etc.) then re-run `%s docker compose -f %s up -d`.\n",
		home, asUser, composePath,
	)
}
