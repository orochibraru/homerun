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

// SelfUpdate replaces the running binary with the latest GitHub release when
// it's newer, falling back to `sudo mv` when the install directory isn't
// writable. Exits the process on any failure, including a platform with no
// prebuilt binaries, which is checked before anything touches the network.
func SelfUpdate() {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		Fail("`homerun update` only supports Linux and macOS, the platforms prebuilt binaries are published for.")
	}
	suffix := AssetSuffix()
	dest, err := os.Executable()
	if err != nil {
		Fail(err.Error())
	}

	fmt.Println("Checking for updates...")
	tag := LatestReleaseTag()
	latestVersion := strings.TrimPrefix(tag, "v")
	if latestVersion == buildinfo.Version {
		fmt.Printf("Already up to date (v%s).\n", buildinfo.Version)
		return
	}

	fmt.Printf("Updating v%s -> v%s...\n", buildinfo.Version, latestVersion)
	tmpPath := DownloadRelease(tag, suffix, dest)

	if err := os.Rename(tmpPath, dest); err != nil {
		sudoMove(tmpPath, dest)
	}

	fmt.Printf("Updated to v%s. Run 'homerun --version' to confirm.\n", latestVersion)
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
