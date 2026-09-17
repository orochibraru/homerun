import { chmodSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Output } from "./output";
import { CLI_VERSION } from "./version";

const GITHUB_HOST = "github.com";
const GITHUB_API = "api.github.com";
const GITHUB_REPO = "orochibraru/homerun";

/** Self-update logic for the compiled binary, grouped as a class for consistency with the rest of cli/ : none of the private helpers carry instance state, this is a one-shot CLI flow like `CliLoginFlow`. */
class CliUpdateService {
	/**
	 * Replaces the running binary with the latest GitHub release when it's
	 * newer, falling back to `sudo mv` when the install directory isn't
	 * writable. Exits the process on any failure, including a host other than
	 * Linux or macOS, or a run from source.
	 */
	async update(): Promise<void> {
		if (process.platform !== "linux" && process.platform !== "darwin") {
			Output.fail(
				"`homerun update` only supports Linux and macOS, the platforms prebuilt binaries are published for.",
			);
		}
		if (!this.#isCompiledBinary()) {
			Output.fail(
				"`homerun update` only works on the installed binary, not `bun run cli/index.ts`. Update the source instead (`git pull`).",
			);
		}

		const arch = this.#currentArch();
		const dest = process.execPath;

		console.log("Checking for updates...");
		const releaseRes = await fetch(
			`https://${GITHUB_API}/repos/${GITHUB_REPO}/releases/latest`,
		).catch((error) =>
			Output.fail(
				`Couldn't check for updates: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
		if (!releaseRes.ok) {
			Output.fail(
				`Couldn't check for updates: ${releaseRes.status} ${releaseRes.statusText}`,
			);
		}
		const release = (await releaseRes.json()) as { tag_name: string };
		const latestVersion = release.tag_name.replace(/^v/, "");

		if (latestVersion === CLI_VERSION) {
			console.log(`Already up to date (v${CLI_VERSION}).`);
			return;
		}

		console.log(`Updating v${CLI_VERSION} -> v${latestVersion}...`);
		const downloadUrl = `https://${GITHUB_HOST}/${GITHUB_REPO}/releases/download/${release.tag_name}/homerun-cli-${arch}`;
		const binRes = await fetch(downloadUrl);
		if (!binRes.ok) {
			Output.fail(`Download failed: ${binRes.status} ${binRes.statusText}`);
		}

		const tmpPath = join(tmpdir(), `homerun-update-${Date.now()}`);
		await Bun.write(tmpPath, binRes);
		chmodSync(tmpPath, 0o755);

		try {
			renameSync(tmpPath, dest);
		} catch {
			// Cross-device (tmp on a different filesystem) or a permission error
			// on the install dir (e.g. /usr/local/bin) : fall back to sudo, same
			// as install.sh does for a non-writable install dir.
			this.#sudoMove(tmpPath, dest);
		}

		console.log(
			`Updated to v${latestVersion}. Run 'homerun --version' to confirm.`,
		);
	}

	/**
	 * Only meaningful for the installed standalone binary (`install.sh`'s
	 * `/usr/local/bin/homerun`) : `bun run cli/index.ts` sets `process.execPath`
	 * to the `bun` runtime itself, there's no single file to replace. A
	 * `bun build --compile` binary *is* the runtime, so its own `execPath`
	 * points back at itself under whatever name it was installed as, which is
	 * what makes the distinction reliable without a separate "am I compiled"
	 * flag baked in at build time.
	 */
	#isCompiledBinary(): boolean {
		const base = process.execPath.split("/").pop();
		return base !== "bun" && base !== "bun-debug";
	}

	/**
	 * Maps `process.platform`/`process.arch` onto the release-asset suffix
	 * (`amd64`, `arm64`, `darwin-amd64`, `darwin-arm64`), exiting on anything
	 * other than x64 or arm64. The arch half is mirrored by
	 * `packages/installer/steps/detect.ts`'s `arch()` : the two sub-projects
	 * can't share a module (each `tsconfig.json`'s `include` is scoped to its
	 * own directory), so keep both in sync by hand, see
	 * `.agents/notes/packages-and-release.md`.
	 */
	#currentArch(): string {
		const prefix = process.platform === "darwin" ? "darwin-" : "";
		if (process.arch === "x64") {
			return `${prefix}amd64`;
		}
		if (process.arch === "arm64") {
			return `${prefix}arm64`;
		}
		return Output.fail(
			`Unsupported architecture "${process.arch}" : prebuilt binaries only cover amd64 and arm64.`,
		);
	}

	/** Same escalation install.sh already relies on for a non-writable install dir. */
	#sudoMove(from: string, to: string): void {
		const result = Bun.spawnSync(["sudo", "mv", from, to]);
		if (result.exitCode !== 0) {
			Output.fail(
				`Couldn't replace ${to} (even with sudo): ${result.stderr.toString()}`,
			);
		}
	}
}

export const UpdateService = new CliUpdateService();
