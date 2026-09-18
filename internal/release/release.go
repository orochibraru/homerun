// Package release knows how Homerun's GitHub releases are laid out: which
// asset a platform gets, where it's downloaded from, and how to unpack it.
// Every binary publishes gzipped as <name>-<suffix>.gz (see
// scripts/upload-release-assets.ts), and the app image is tagged per release.
package release

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
)

// Repo is the GitHub repository releases are published to.
const Repo = "orochibraru/homerun"

// RegistryHost is where the app's Docker image is published.
const RegistryHost = "docker.io"

// APIBase and DownloadBase are GitHub's API and download hosts. Variables, not
// constants, so tests can point them at a local server.
var (
	APIBase      = "https://api.github.com"
	DownloadBase = "https://github.com"
)

// Arch maps a Go architecture onto the release-asset arch names, amd64 or
// arm64. Release binaries cover nothing else.
func Arch(goarch string) (string, error) {
	switch goarch {
	case "amd64", "arm64":
		return goarch, nil
	default:
		return "", fmt.Errorf(
			"Unsupported architecture %q : release binaries only cover amd64 and arm64.",
			goarch,
		)
	}
}

// AssetSuffix is the release-asset suffix for a platform: amd64 or arm64 on
// Linux, darwin-amd64 or darwin-arm64 on macOS. Only the CLI ships macOS
// builds; the installer and agent only ever run on the Linux host they manage.
func AssetSuffix(goos, goarch string) (string, error) {
	arch, err := Arch(goarch)
	if err != nil {
		return "", err
	}
	switch goos {
	case "linux":
		return arch, nil
	case "darwin":
		return "darwin-" + arch, nil
	default:
		return "", fmt.Errorf("Unsupported platform %q : release binaries only cover Linux and macOS.", goos)
	}
}

// AssetURL is GitHub's release-asset shape: /releases/latest/download/<file>
// for the newest tag, /releases/download/<tag>/<file> to pin one.
func AssetURL(version, filename string) string {
	if version == "latest" {
		return fmt.Sprintf("%s/%s/releases/latest/download/%s", DownloadBase, Repo, filename)
	}
	return fmt.Sprintf("%s/%s/releases/download/%s/%s", DownloadBase, Repo, version, filename)
}

// ImageRef is the app image for a release. The publish workflow tags it both
// :vX.Y.Z and :latest, so a pinned release gets the matching image.
func ImageRef(version string) string {
	return fmt.Sprintf("%s/%s:%s", RegistryHost, Repo, version)
}

// LatestTag asks GitHub for the newest published release's tag. A draft isn't
// returned, so a release whose assets are still uploading is never offered.
func LatestTag(client *http.Client) (string, error) {
	response, err := client.Get(fmt.Sprintf("%s/repos/%s/releases/latest", APIBase, Repo))
	if err != nil {
		return "", fmt.Errorf("Couldn't check for updates: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf(
			"Couldn't check for updates: %d %s",
			response.StatusCode, http.StatusText(response.StatusCode),
		)
	}
	var latest struct {
		TagName string `json:"tag_name"`
	}
	if err := json.NewDecoder(response.Body).Decode(&latest); err != nil {
		return "", fmt.Errorf("Couldn't read the latest release: %w", err)
	}
	return latest.TagName, nil
}

// DownloadGzipped fetches a gzipped release asset, unpacks it into a new
// executable file in dir, and returns that file's path. Staging it beside its
// final destination keeps the caller's replacing rename on one filesystem.
// When dir isn't writable (a root-owned /usr/local/bin), it stages in the
// system temp directory instead: the caller's rename then fails and falls back
// to `sudo mv`, which moves across filesystems anyway.
func DownloadGzipped(client *http.Client, url, dir string) (string, error) {
	response, err := client.Get(url)
	if err != nil {
		return "", fmt.Errorf("Download failed: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf(
			"Download failed: %d %s",
			response.StatusCode, http.StatusText(response.StatusCode),
		)
	}

	unpacked, err := gzip.NewReader(response.Body)
	if err != nil {
		return "", fmt.Errorf("Download failed: %w", err)
	}
	defer func() { _ = unpacked.Close() }()

	staged, err := os.CreateTemp(dir, ".homerun-download-")
	if err != nil {
		staged, err = os.CreateTemp("", "homerun-download-")
	}
	if err != nil {
		return "", err
	}
	if _, err := io.Copy(staged, unpacked); err != nil {
		_ = staged.Close()
		_ = os.Remove(staged.Name())
		return "", fmt.Errorf("Download failed: %w", err)
	}
	if err := staged.Close(); err != nil {
		_ = os.Remove(staged.Name())
		return "", err
	}
	if err := os.Chmod(staged.Name(), 0o755); err != nil {
		_ = os.Remove(staged.Name())
		return "", err
	}
	return filepath.Clean(staged.Name()), nil
}
