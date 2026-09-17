import type { StepRunner } from "../exec";

/**
 * Every release (`.github/workflows/publish.yaml` : `binaries` job +
 * `.releaserc.json`'s `@semantic-release/github` assets) publishes prebuilt
 * agent/cli/installer binaries for linux/amd64 + linux/arm64 as GitHub
 * release assets on this repo, and the `build` job pushes the app itself as
 * a Docker image (`docker.yaml`, `IMAGE=docker.io/orochibraru/homerun`).
 * This installer only ever consumes those two artifact kinds : it never
 * clones source, never runs `bun install`/`bun run build`, and needs
 * neither git nor Bun on the target host.
 */
const RELEASE_HOST = "github.com";
const REGISTRY_HOST = "docker.io";
const REPO = "orochibraru/homerun";

/** Grouped as a class for consistency with the rest of installer/steps/ : `releaseAssetUrl`/`imageRef` are pure transforms, `downloadReleaseBinary` is the one method with a real side effect (shells out via the given `StepRunner`). */
class ReleaseAssetsService {
	/** GitHub's release-asset shape : `/releases/latest/download/<file>` for the newest tag, `/releases/download/<tag>/<file>` to pin one. */
	releaseAssetUrl(version: string, filename: string): string {
		const path =
			version === "latest"
				? `releases/latest/download/${filename}`
				: `releases/download/${version}/${filename}`;
		return `https://${RELEASE_HOST}/${REPO}/${path}`;
	}

	/** `publish.yaml`'s `promote` job publishes the app image as both `:vX.Y.Z` and `:latest`, so `--version=` pins the image to the same release as the binaries. */
	imageRef(version: string): string {
		const tag = version === "latest" ? "latest" : version;
		return `${REGISTRY_HOST}/${REPO}:${tag}`;
	}

	/**
	 * Downloads a release binary next to `dest`, makes it executable, then
	 * renames it over `dest`. No git, no build step : this is the only way
	 * this installer installs the agent (or itself, via bootstrap.sh). The
	 * rename is what lets a re-run replace a binary that's running: curl
	 * writing straight into it fails with "Text file busy" (verified live,
	 * curl exit 23).
	 */
	async downloadReleaseBinary(
		run: StepRunner,
		version: string,
		filename: string,
		dest: string,
	): Promise<void> {
		const url = this.releaseAssetUrl(version, filename);
		const staging = `${dest}.download`;
		await run.run(["curl", "-fsSL", url, "-o", staging]);
		await run.run(["chmod", "+x", staging]);
		await run.run(["mv", "-f", staging, dest]);
	}
}

export const ReleaseAssets = new ReleaseAssetsService();
