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

	/**
	 * The app's Docker image, by contrast, is not tagged per semantic-release
	 * version : `docker.yaml` (driven from `publish.yaml`'s `build` job) tags
	 * every push to main as `:<commit sha>` and `:latest`, there is no `:vX.Y.Z`
	 * tag. `--version=` therefore only selects which release's agent/installer/
	 * cli *binaries* to fetch ; the app image installed in `--mode=full` is
	 * always `:latest` (or the literal tag passed, for a caller who knows a
	 * matching sha), that's a real asymmetry in this repo's release pipeline,
	 * not an oversight here.
	 */
	imageRef(version: string): string {
		const tag = version === "latest" ? "latest" : version;
		return `${REGISTRY_HOST}/${REPO}:${tag}`;
	}

	/** Downloads a release binary straight to `dest` and makes it executable. No git, no build step : this is the only way this installer installs the agent (or itself, via bootstrap.sh). */
	async downloadReleaseBinary(
		run: StepRunner,
		version: string,
		filename: string,
		dest: string,
	): Promise<void> {
		const url = this.releaseAssetUrl(version, filename);
		await run.run(["curl", "-fsSL", url, "-o", dest]);
		await run.run(["chmod", "+x", dest]);
	}
}

export const ReleaseAssets = new ReleaseAssetsService();
