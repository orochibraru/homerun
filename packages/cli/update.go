package main

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	githubAPI  = "api.github.com"
	githubHost = "github.com"
	githubRepo = "orochibraru/homerun"
)

// selfUpdate replaces the running binary with the latest GitHub release when
// it's newer, falling back to `sudo mv` when the install directory isn't
// writable. Exits the process on any failure, including a platform with no
// prebuilt binaries.
func selfUpdate() {
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		fail("`homerun update` only supports Linux and macOS, the platforms prebuilt binaries are published for.")
	}
	dest, err := os.Executable()
	if err != nil {
		fail(err.Error())
	}

	fmt.Println("Checking for updates...")
	tag := latestReleaseTag()
	latestVersion := strings.TrimPrefix(tag, "v")
	if latestVersion == version {
		fmt.Printf("Already up to date (v%s).\n", version)
		return
	}

	fmt.Printf("Updating v%s -> v%s...\n", version, latestVersion)
	tmpPath := downloadRelease(tag, dest)

	if err := os.Rename(tmpPath, dest); err != nil {
		// Cross-device (tmp on a different filesystem) or a permission error on
		// the install dir (e.g. /usr/local/bin) : fall back to sudo, same as
		// install.sh does for a non-writable install dir.
		sudoMove(tmpPath, dest)
	}

	fmt.Printf("Updated to v%s. Run 'homerun --version' to confirm.\n", latestVersion)
}

// latestReleaseTag asks GitHub for the newest release's tag.
func latestReleaseTag() string {
	response, err := http.Get(fmt.Sprintf("https://%s/repos/%s/releases/latest", githubAPI, githubRepo))
	if err != nil {
		fail(fmt.Sprintf("Couldn't check for updates: %s", err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fail(fmt.Sprintf(
			"Couldn't check for updates: %d %s",
			response.StatusCode, http.StatusText(response.StatusCode),
		))
	}
	var release struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(response.Body).Decode(&release); err != nil {
		fail(err.Error())
	}
	return release.TagName
}

// downloadRelease fetches this platform's gzipped release asset, unpacks it
// next to dest (so the replacing rename stays on one filesystem) and returns
// the staged path.
func downloadRelease(tag, dest string) string {
	url := fmt.Sprintf(
		"https://%s/%s/releases/download/%s/homerun-cli-%s.gz",
		githubHost, githubRepo, tag, assetSuffix(),
	)
	response, err := http.Get(url)
	if err != nil {
		fail(fmt.Sprintf("Download failed: %s", err))
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		fail(fmt.Sprintf(
			"Download failed: %d %s",
			response.StatusCode, http.StatusText(response.StatusCode),
		))
	}

	unpacked, err := gzip.NewReader(response.Body)
	if err != nil {
		fail(fmt.Sprintf("Download failed: %s", err))
	}
	defer unpacked.Close()

	staged, err := os.CreateTemp(filepath.Dir(dest), ".homerun-update-")
	if err != nil {
		staged, err = os.CreateTemp("", "homerun-update-")
	}
	if err != nil {
		fail(err.Error())
	}
	if _, err := io.Copy(staged, unpacked); err != nil {
		staged.Close()
		fail(err.Error())
	}
	staged.Close()
	if err := os.Chmod(staged.Name(), 0o755); err != nil {
		fail(err.Error())
	}
	return staged.Name()
}

// assetSuffix maps this platform onto the release-asset suffix (amd64, arm64,
// darwin-amd64, darwin-arm64), exiting on anything other than x86-64 or arm64.
// Mirrored by packages/installer/steps/detect.ts's arch().
func assetSuffix() string {
	prefix := ""
	if runtime.GOOS == "darwin" {
		prefix = "darwin-"
	}
	switch runtime.GOARCH {
	case "amd64":
		return prefix + "amd64"
	case "arm64":
		return prefix + "arm64"
	default:
		fail(fmt.Sprintf(
			"Unsupported architecture %q : prebuilt binaries only cover amd64 and arm64.",
			runtime.GOARCH,
		))
		return ""
	}
}

// sudoMove is the same escalation install.sh already relies on for a
// non-writable install dir.
func sudoMove(from, to string) {
	command := exec.Command("sudo", "mv", from, to)
	command.Stdin = os.Stdin
	command.Stderr = os.Stderr
	if err := command.Run(); err != nil {
		fail(fmt.Sprintf("Couldn't replace %s (even with sudo): %s", to, err))
	}
}
