package main

import "fmt"

const (
	releaseHost  = "github.com"
	registryHost = "docker.io"
	repo         = "orochibraru/homerun"
)

// Every release (.github/workflows/publish.yaml's binaries job plus
// scripts/upload-release-assets.ts) publishes prebuilt agent/cli/installer
// binaries as gzipped GitHub release assets on this repo, and the build job
// pushes the app itself as a Docker image. This installer only ever consumes
// those two artifact kinds: it never clones source, never runs a build, and
// needs neither git nor a language runtime on the target host.

// ReleaseAssetURL is GitHub's release-asset shape: /releases/latest/download/<file>
// for the newest tag, /releases/download/<tag>/<file> to pin one.
func ReleaseAssetURL(version, filename string) string {
	if version == "latest" {
		return fmt.Sprintf("https://%s/%s/releases/latest/download/%s", releaseHost, repo, filename)
	}
	return fmt.Sprintf("https://%s/%s/releases/download/%s/%s", releaseHost, repo, version, filename)
}

// ImageRef is the app image for a version. publish.yaml's promote job publishes
// it as both :vX.Y.Z and :latest, so --version= pins the image to the same
// release as the binaries.
func ImageRef(version string) string {
	tag := version
	if version == "latest" {
		tag = "latest"
	}
	return fmt.Sprintf("%s/%s:%s", registryHost, repo, tag)
}

// DownloadReleaseBinary downloads a release binary (gzipped, see
// scripts/upload-release-assets.ts) next to dest, unpacks it, makes it
// executable, then renames it over dest. No git, no build step: this is the
// only way this installer installs the agent (or itself, via bootstrap.sh).
// The rename is what lets a re-run replace a binary that's running: curl
// writing straight into it fails with "Text file busy" (verified live, curl
// exit 23).
func DownloadReleaseBinary(run Runner, version, filename, dest string) error {
	url := ReleaseAssetURL(version, filename+".gz")
	staging := dest + ".download"
	if _, err := run.Run([]string{"curl", "-fsSL", url, "-o", staging + ".gz"}, Opts{}); err != nil {
		return err
	}
	if _, err := run.Run([]string{"gunzip", "-f", staging + ".gz"}, Opts{}); err != nil {
		return err
	}
	if _, err := run.Run([]string{"chmod", "+x", staging}, Opts{}); err != nil {
		return err
	}
	_, err := run.Run([]string{"mv", "-f", staging, dest}, Opts{})
	return err
}
