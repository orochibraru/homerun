import process from "node:process";
import { createInterface } from "node:readline/promises";
import { ClientFactory } from "./client";
import { ConfigStore, type StoredConfig } from "./config";
import { Output } from "./output";

function question(prompt: string, fallback: string): Promise<string> {
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const suffix = fallback ? ` (${fallback})` : "";
	return rl
		.question(`${prompt}${suffix}: `)
		.then((answer) => answer.trim() || fallback)
		.finally(() => rl.close());
}

interface DeviceStart {
	deviceCode: string;
	expiresIn: number;
	interval: number;
	userCode: string;
	verificationUri: string;
	verificationUriComplete: string;
}

interface PollResult {
	apiKey?: string;
	status: "approved" | "denied" | "expired" | "pending";
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Grouped as a class purely for consistency with the rest of cli/, neither method carries instance state, both are one-shot CLI flows. */
class CliLoginFlow {
	/**
	 * Machine-to-machine login: the CLI has no browser of its own to redirect
	 * through (and often runs on a headless/remote box entirely), so this is a
	 * device-code flow, same shape as `gh auth login`'s non-web option or a
	 * smart-TV OAuth sign-in, not a localhost-callback flow. A human approves
	 * from *any* already-authenticated browser tab by typing the short code
	 * shown here, the CLI just polls until that happens.
	 */
	async login(flagBaseUrl?: string): Promise<void> {
		const baseUrl = await this.#resolveBaseUrl(flagBaseUrl);
		const start = await this.#startDeviceAuth(baseUrl);

		console.log(
			"\nTo finish logging in, open this URL and enter the code below:\n",
		);
		console.log(`  ${start.verificationUri}`);
		console.log(`\n  Code: ${start.userCode}\n`);
		console.log(
			`(or open ${start.verificationUriComplete} to skip typing it)\n`,
		);
		console.log("Waiting for approval...");

		await this.#pollForApproval(baseUrl, start);
	}

	/** The instance URL, from `--url`, the stored config, or an interactive prompt, with any trailing slash stripped. */
	async #resolveBaseUrl(flagBaseUrl?: string): Promise<string> {
		const existing = ConfigStore.readStoredConfig();
		const rawBaseUrl =
			flagBaseUrl ??
			(await question("Homerun instance URL", existing?.baseUrl ?? ""));
		if (!rawBaseUrl) {
			Output.fail("A base URL is required (e.g. https://homerun.example.com).");
		}
		return rawBaseUrl.replace(/\/$/, "");
	}

	/** Opens the device-authorization request, returning the codes the human needs to approve it. */
	async #startDeviceAuth(baseUrl: string): Promise<DeviceStart> {
		const startRes = await fetch(`${baseUrl}/api/v1/auth/cli/device`, {
			method: "POST",
		}).catch((error) =>
			Output.fail(
				`Couldn't reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
			),
		);
		if (!startRes.ok) {
			Output.fail(
				`Couldn't start login: ${startRes.status} ${startRes.statusText}`,
			);
		}
		return (await startRes.json()) as DeviceStart;
	}

	/** Polls until the request is approved (storing the key), rejected, or the deadline passes. */
	async #pollForApproval(baseUrl: string, start: DeviceStart): Promise<void> {
		const deadline = Date.now() + start.expiresIn * 1000;
		while (Date.now() < deadline) {
			// biome-ignore lint/performance/noAwaitInLoops: device-flow polling is sequential by definition
			await sleep(start.interval * 1000);

			const pollRes = await fetch(`${baseUrl}/api/v1/auth/cli/token`, {
				body: JSON.stringify({ deviceCode: start.deviceCode }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			if (!pollRes.ok) {
				Output.fail(`Login failed: ${pollRes.status} ${pollRes.statusText}`);
			}
			const result = (await pollRes.json()) as PollResult;

			if (result.status === "denied") {
				Output.fail("Login request was denied.");
			}
			if (result.status === "expired") {
				Output.fail("Login request expired. Run `homerun login` again.");
			}
			if (result.status === "approved" && result.apiKey) {
				ConfigStore.writeStoredConfig({ apiKey: result.apiKey, baseUrl });
				console.log(`\nLogged in to ${baseUrl}.`);
				console.log(`Config saved to ${ConfigStore.configPath()}.`);
				return;
			}
		}

		Output.fail("Timed out waiting for approval. Run `homerun login` again.");
	}

	/**
	 * Revokes the API key on the server (`DELETE /api/v1/auth-token`, which
	 * revokes whichever key authenticated the request, i.e. this one), then
	 * always clears the local config, even when the server call fails, so a
	 * stale/unreachable instance can never block logging out locally.
	 */
	async logout(): Promise<void> {
		const existing = ConfigStore.readStoredConfig();
		if (!existing) {
			console.log("Not logged in.");
			return;
		}

		const revoked = await this.#revokeApiKey(existing);
		ConfigStore.clearStoredConfig();

		console.log(
			revoked
				? `Logged out of ${existing.baseUrl} and revoked the API key.`
				: `Logged out of ${existing.baseUrl}. Couldn't revoke the API key on the server (it may already be invalid, or the server is unreachable) : cleared the local config anyway.`,
		);
	}

	/** Best-effort: any thrown error or non-ok response just means the local logout proceeds without server-side revocation. */
	async #revokeApiKey(config: StoredConfig): Promise<boolean> {
		try {
			const client = ClientFactory.makeClient(config);
			const { response } = await client.DELETE("/auth-token", {});
			return response.ok;
		} catch {
			return false;
		}
	}
}

export const LoginFlow = new CliLoginFlow();
