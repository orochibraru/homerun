package main

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"regexp"
	"runtime"
	"strings"
)

// PackageManager is the host's package manager and the argv that installs with it.
type PackageManager struct {
	Install []string
	Kind    string
}

// srcAddress pulls the source address out of `ip route get` output.
var srcAddress = regexp.MustCompile(`\bsrc\s+(\S+)`)

// DetectPackageManager picks the host's package manager. Best-effort: apt is
// the primary target (Debian/Ubuntu, the overwhelming majority of homelab/VPS
// installs); dnf/yum are supported on a "should work, less exercised" basis.
func DetectPackageManager() (PackageManager, error) {
	if commandExists("apt-get") {
		return PackageManager{Install: []string{"apt-get", "install", "-y"}, Kind: "apt"}, nil
	}
	if commandExists("dnf") {
		return PackageManager{Install: []string{"dnf", "install", "-y"}, Kind: "dnf"}, nil
	}
	if commandExists("yum") {
		return PackageManager{Install: []string{"yum", "install", "-y"}, Kind: "yum"}, nil
	}
	return PackageManager{}, errors.New(
		"No supported package manager found (apt-get, dnf, yum). This installer targets Debian/Ubuntu/RHEL-family Linux : install Docker + rootless-extras by hand elsewhere.",
	)
}

// RequireLinux fails when not running on Linux, since the install relies on
// systemd and rootless Docker.
func RequireLinux() error {
	if runtime.GOOS != "linux" {
		return fmt.Errorf(
			"This installer sets up a Linux server (systemd + rootless Docker) : refusing to run on %s. Run it on the target server itself, not your workstation.",
			runtime.GOOS,
		)
	}
	return nil
}

// RequireRoot fails when the effective uid isn't root, since the install
// creates users, installs packages and writes units.
func RequireRoot() error {
	if os.Geteuid() != 0 {
		return errors.New(
			"This installer needs root (it creates a system user, installs packages, and writes systemd units) : re-run with sudo.",
		)
	}
	return nil
}

// HostAddress is a best-effort "what address is this box actually reachable
// at": the source IP of the route out to the internet, falling back to the
// first address `hostname -I` reports. Loopback is never returned: an origin of
// localhost is exactly what makes the first sign-up on a fresh install fail
// with better-auth's "Invalid origin" once the dashboard is opened from any
// other machine (SvelteKit normalizes event.url to ORIGIN, so the derived
// trusted origin is localhost while the browser's Origin header is the real
// address).
//
// Returns the empty string when no usable address could be found.
func HostAddress() string {
	candidates := []string{}
	if route := commandOutput([]string{"ip", "-4", "route", "get", "1.1.1.1"}); route != "" {
		if match := srcAddress.FindStringSubmatch(route); match != nil {
			candidates = append(candidates, match[1])
		}
	}
	if hostnames := commandOutput([]string{"hostname", "-I"}); hostnames != "" {
		candidates = append(candidates, strings.Fields(hostnames)...)
	}
	return firstRoutableAddress(candidates)
}

// firstRoutableAddress is the first candidate that isn't loopback.
func firstRoutableAddress(candidates []string) string {
	for _, address := range candidates {
		if address == "" || address == "::1" || strings.HasPrefix(address, "127.") {
			continue
		}
		return address
	}
	return ""
}

// commandOutput runs a command and returns its stdout, or the empty string when
// it exits non-zero or can't be spawned. Bypasses the Runner, so it runs even
// under --dry-run.
var commandOutput = func(cmd []string) string {
	output, err := exec.Command(cmd[0], cmd[1:]...).Output()
	if err != nil {
		return ""
	}
	return string(output)
}

// Arch is "amd64" or "arm64", matching this repo's own release-asset naming
// (scripts/build-packages.ts's homerun-<pkg>-<arch> filenames). Mirrored by
// packages/cli/update.go's assetSuffix, which adds a darwin- prefix the
// installer never needs, since it only ever runs on the Linux box it's
// installing.
//
// Returns an error when GOARCH is anything but amd64/arm64: release binaries
// only cover linux/amd64 and linux/arm64.
func Arch() (string, error) {
	switch runtime.GOARCH {
	case "amd64":
		return "amd64", nil
	case "arm64":
		return "arm64", nil
	default:
		return "", fmt.Errorf(
			"Unsupported architecture %q : release binaries only cover linux/amd64 and linux/arm64.",
			runtime.GOARCH,
		)
	}
}
