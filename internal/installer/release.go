package installer

import "github.com/orochibraru/homerun/internal/release"

// DownloadReleaseBinary downloads a release binary (gzipped, see
// scripts/upload-release-assets.ts) next to dest, unpacks it, makes it
// executable, then renames it over dest. No git, no build step: this is the
// only way this installer installs the agent (or itself, via bootstrap.sh).
// The rename is what lets a re-run replace a binary that's running: curl
// writing straight into it fails with "Text file busy" (verified live, curl
// exit 23).
func DownloadReleaseBinary(run Runner, version, filename, dest string) error {
	url := release.AssetURL(version, filename+".gz")
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
