package cli

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/orochibraru/homerun/internal/buildinfo"
	"github.com/orochibraru/homerun/internal/release"
)

// SelfUpdate replaces the running binary with the newest release on channel
// ("stable", "canary" or "nightly") when it's strictly newer, falling back to `sudo mv`
// when the install directory isn't writable. Never downgrades: a canary CLI
// updating on stable stays put until a stable release overtakes it. Exits the
// process on any failure, including a platform with no prebuilt binaries,
// which is checked before anything touches the network.
func SelfUpdate(channel string) {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		Fail("`homerun update` only supports Linux and macOS, the platforms prebuilt binaries are published for.")
	}
	suffix := AssetSuffix()
	dest, err := os.Executable()
	if err != nil {
		Fail(err.Error())
	}

	fmt.Printf("Checking for %s updates...\n", channel)
	tag, latestVersion := LatestRelease(channel)
	if !release.IsNewer(latestVersion, buildinfo.Version) {
		if release.IsNewer(buildinfo.Version, latestVersion) {
			fmt.Printf("Already up to date (v%s, ahead of %s v%s).\n", buildinfo.Version, channel, latestVersion)
		} else {
			fmt.Printf("Already up to date (v%s).\n", buildinfo.Version)
		}
		return
	}

	fmt.Printf("Updating v%s -> v%s...\n", buildinfo.Version, latestVersion)
	tmpPath := DownloadRelease(tag, suffix, dest)

	if err := os.Rename(tmpPath, dest); err != nil {
		sudoMove(tmpPath, dest)
	}

	fmt.Printf("Updated to v%s. Run 'homerun --version' to confirm.\n", latestVersion)
}

// LatestRelease is the tag to download from and the version it carries for
// channel: the newest stable release, or the newest canary or nightly
// prerelease.
// Exits on failure or an unknown channel.
func LatestRelease(channel string) (string, string) {
	switch channel {
	case "stable":
		tag := LatestReleaseTag()
		return tag, strings.TrimPrefix(tag, "v")
	case "canary", "nightly":
		tag, version, err := release.LatestPrerelease(http.DefaultClient, channel)
		if err != nil {
			Fail(err.Error())
		}
		return tag, version
	default:
		Fail(fmt.Sprintf("unknown channel %q: use stable, canary or nightly.", channel))
		return "", ""
	}
}

// LatestReleaseTag asks GitHub for the newest release's tag, exiting on failure.
func LatestReleaseTag() string {
	tag, err := release.LatestTag(http.DefaultClient)
	if err != nil {
		Fail(err.Error())
	}
	return tag
}

// DownloadRelease fetches this platform's gzipped CLI asset for tag, unpacks it
// next to dest (so the replacing rename stays on one filesystem) and returns
// the staged path, exiting on failure.
func DownloadRelease(tag, suffix, dest string) string {
	url := release.AssetURL(tag, fmt.Sprintf("homerun-cli-%s.gz", suffix))
	staged, err := release.DownloadGzipped(http.DefaultClient, url, filepath.Dir(dest))
	if err != nil {
		Fail(err.Error())
	}
	return staged
}

// AssetSuffix is this platform's release-asset suffix, exiting on a platform
// with no prebuilt binary.
func AssetSuffix() string {
	suffix, err := release.AssetSuffix(runtime.GOOS, runtime.GOARCH)
	if err != nil {
		Fail(err.Error())
	}
	return suffix
}

// sudoMove is the same escalation install.sh already relies on for a
// non-writable install dir.
func sudoMove(from, to string) {
	command := exec.Command("sudo", "mv", from, to)
	command.Stdin = os.Stdin
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		Fail(fmt.Sprintf("Couldn't replace %s (even with sudo): %s", to, err))
	}
}
