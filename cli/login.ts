import { createInterface } from "node:readline/promises";
import {
	clearStoredConfig,
	configPath,
	readStoredConfig,
	writeStoredConfig,
} from "./config";
import { fail } from "./output";

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

/**
 * Machine-to-machine login: the CLI has no browser of its own to redirect
 * through (and often runs on a headless/remote box entirely), so this is a
 * device-code flow, same shape as `gh auth login`'s non-web option or a
 * smart-TV OAuth sign-in, not a localhost-callback flow. A human approves
 * from *any* already-authenticated browser tab by typing the short code
 * shown here, the CLI just polls until that happens.
 */
export async function login(argv: string[]): Promise<void> {
	const flagIndex = argv.indexOf("--base-url");
	const flagBaseUrl = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;
	const existing = readStoredConfig();

	const rawBaseUrl =
		flagBaseUrl ??
		(await question("Homerun instance URL", existing?.baseUrl ?? ""));
	if (!rawBaseUrl) {
		fail("A base URL is required (e.g. https://homerun.example.com).");
	}
	const baseUrl = rawBaseUrl.replace(/\/$/, "");

	const startRes = await fetch(`${baseUrl}/api/v1/auth/cli/device`, {
		method: "POST",
	}).catch((error) => {
		fail(
			`Couldn't reach ${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
	if (!startRes.ok) {
		fail(`Couldn't start login: ${startRes.status} ${startRes.statusText}`);
	}
	const start = (await startRes.json()) as DeviceStart;

	console.log(
		"\nTo finish logging in, open this URL and enter the code below:\n",
	);
	console.log(`  ${start.verificationUri}`);
	console.log(`\n  Code: ${start.userCode}\n`);
	console.log(`(or open ${start.verificationUriComplete} to skip typing it)\n`);
	console.log("Waiting for approval...");

	const deadline = Date.now() + start.expiresIn * 1000;
	while (Date.now() < deadline) {
		await sleep(start.interval * 1000);

		const pollRes = await fetch(`${baseUrl}/api/v1/auth/cli/token`, {
			body: JSON.stringify({ deviceCode: start.deviceCode }),
			headers: { "content-type": "application/json" },
			method: "POST",
		});
		if (!pollRes.ok) {
			fail(`Login failed: ${pollRes.status} ${pollRes.statusText}`);
		}
		const result = (await pollRes.json()) as PollResult;

		if (result.status === "pending") {
			continue;
		}
		if (result.status === "denied") {
			fail("Login request was denied.");
		}
		if (result.status === "expired") {
			fail("Login request expired. Run `homerun login` again.");
		}
		if (result.status === "approved" && result.apiKey) {
			writeStoredConfig({ apiKey: result.apiKey, baseUrl });
			console.log(`\nLogged in to ${baseUrl}.`);
			console.log(`Config saved to ${configPath()}.`);
			return;
		}
	}

	fail("Timed out waiting for approval. Run `homerun login` again.");
}

export function logout(): void {
	const existing = readStoredConfig();
	if (!existing) {
		console.log("Not logged in.");
		return;
	}
	clearStoredConfig();
	console.log(`Logged out of ${existing.baseUrl}.`);
}
