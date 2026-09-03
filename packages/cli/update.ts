import { chmodSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { Output } from "./output";
import { CLI_VERSION } from "./version";

const GITEA_HOST = "git.ombrage.space";
const GITEA_REPO = "orochibraru/homerun";

/** Self-update logic for the compiled binary, grouped as a class for consistency with the rest of cli/ : none of the private helpers carry instance state, this is a one-shot CLI flow like `CliLoginFlow`. */
class CliUpdateService {
	async update(): Promise<void> {
		if (process.platform !== "linux") {
			Output.fail(
				"`homerun update` only supports Linux, the only platform prebuilt binaries are published for. Rebuild from source instead, see cli/README.md.",
			);
		}
		if (!this.#isCompiledBinary()) {
			Output.fail(
				"`homerun update` only works on the installed binary, not `bun run cli/index.ts`. Update the source instead (`git pull`).",
			);
		}

		const arch = this.#currentArch();
		const dest = process.execPath;
		const releaseRes = await fetch(
			`https://${GITEA_HOST}/api/v1/repos/${GITEA_REPO}/releases/latest`,
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
			return;
		}
		const downloadUrl = `https://${GITEA_HOST}/${GITEA_REPO}/releases/download/${release.tag_name}/homerun-cli-${arch}`;
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

	#currentArch(): "amd64" | "arm64" {
		if (process.arch === "x64") {
			return "amd64";
		}
		if (process.arch === "arm64") {
			return "arm64";
		}
		return Output.fail(
			`Unsupported architecture "${process.arch}" : prebuilt binaries only cover linux/amd64 and linux/arm64.`,
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
