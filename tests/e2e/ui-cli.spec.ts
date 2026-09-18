import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { expect, type Page, test } from "@playwright/test";
import { E2E_BASE_URL } from "./support/config";

interface CliResult {
	code: number | null;
	stderr: string;
	stdout: string;
}

interface CliOptions {
	env?: Record<string, string>;
	home: string;
}

const CLI_BINARY = join(
	mkdtempSync(join(tmpdir(), "homerun-cli-bin-")),
	"homerun",
);
const CLI_VERSION: string = JSON.parse(
	readFileSync(join(process.cwd(), "package.json"), "utf8"),
).version;
const homes: string[] = [];

function freshHome(): string {
	const home = mkdtempSync(join(tmpdir(), "homerun-cli-e2e-"));
	homes.push(home);
	return home;
}

function configFile(home: string): string {
	return join(home, ".config", "homerun", "config.json");
}

function cliEnv({ env, home }: CliOptions): NodeJS.ProcessEnv {
	const {
		FORCE_COLOR: _forceColor,
		HOMERUN_API_KEY: _apiKey,
		HOMERUN_BASE_URL: _baseUrl,
		...base
	} = process.env;
	return {
		...base,
		HOME: home,
		NO_COLOR: "1",
		XDG_CONFIG_HOME: join(home, ".config"),
		...env,
	};
}

// The CLI is a Go program (cmd/cli/*.go), so these specs drive the real
// compiled binary, version stamped exactly as scripts/build-packages.ts does.
function buildCli(): void {
	const build = spawnSync(
		"go",
		[
			"build",
			"-ldflags",
			`-X github.com/orochibraru/homerun/internal/buildinfo.Version=${CLI_VERSION}`,
			"-o",
			CLI_BINARY,
			"./cmd/cli",
		],
		{ cwd: process.cwd(), encoding: "utf8" },
	);
	if (build.status !== 0) {
		throw new Error(`go build failed: ${build.stderr || build.stdout}`);
	}
}

function startCli(args: string[], options: CliOptions): ChildProcess {
	return spawn(CLI_BINARY, args, {
		cwd: process.cwd(),
		env: cliEnv(options),
		stdio: ["ignore", "pipe", "pipe"],
	});
}

function collect(child: ChildProcess): Promise<CliResult> {
	return new Promise((resolveResult, reject) => {
		let stdout = "";
		let stderr = "";
		child.stdout?.on("data", (chunk: Buffer) => {
			stdout += chunk.toString();
		});
		child.stderr?.on("data", (chunk: Buffer) => {
			stderr += chunk.toString();
		});
		child.once("error", reject);
		child.once("close", (code) => resolveResult({ code, stderr, stdout }));
	});
}

function cli(args: string[], options: CliOptions): Promise<CliResult> {
	return collect(startCli(args, options));
}

function waitForOutput(child: ChildProcess, pattern: RegExp): Promise<string> {
	return new Promise((resolveMatch, reject) => {
		let buffered = "";
		const onData = (chunk: Buffer) => {
			buffered += chunk.toString();
			const match = buffered.match(pattern);
			if (match) {
				child.stdout?.off("data", onData);
				resolveMatch(match[1] ?? match[0]);
			}
		};
		child.stdout?.on("data", onData);
		child.once("close", (code) =>
			reject(new Error(`CLI exited (${code}) before printing ${pattern}`)),
		);
	});
}

async function signIn(page: Page) {
	await page.goto("/auth/sign-in");
	await page.locator("#email").fill("ada@example.com");
	await page.getByRole("button", { exact: true, name: "Continue" }).click();
	await page.locator("#password").fill("a-real-strong-password-123");
	await page.getByRole("button", { name: "Sign in" }).click();
	await expect(page).toHaveURL(/^http:\/\/127\.0\.0\.1:4310\/$/);
}

async function api<T>(
	apiKey: string,
	path: string,
	body: Record<string, unknown>,
): Promise<T> {
	const res = await fetch(`${E2E_BASE_URL}/api/v1${path}`, {
		body: JSON.stringify(body),
		headers: { "content-type": "application/json", "x-api-key": apiKey },
		method: "POST",
	});
	expect(res.status).toBe(201);
	return (await res.json()) as T;
}

test.describe
	.serial("homerun CLI against the E2E instance", () => {
		let home = "";
		let apiKey = "";
		let stackId = "";
		let serviceIds: string[] = [];

		test.beforeAll(() => {
			buildCli();
			home = freshHome();
		});

		test.afterAll(() => {
			for (const dir of homes) {
				rmSync(dir, { force: true, recursive: true });
			}
		});

		test("prints help, its version, and refuses to run without a login", async () => {
			const help = await cli([], { home });
			expect(help.code).toBe(0);
			expect(help.stdout).toContain("Usage: homerun");
			expect(help.stdout).toContain("stacks");

			const version = await cli(["--version"], { home });
			expect(version.code).toBe(0);
			expect(version.stdout.trim()).toBe(CLI_VERSION);

			const list = await cli(["services", "list"], { home });
			expect(list.code).toBe(1);
			expect(list.stderr).toContain(
				"Not logged in. Run `homerun login` to get started.",
			);

			const missingArg = await cli(["services", "get"], { home });
			expect(missingArg.code).toBe(1);
			expect(missingArg.stderr).toContain("missing <id>");
		});

		test("login fails cleanly when the instance is unreachable", async () => {
			const result = await cli(["login", "--base-url", "http://127.0.0.1:9"], {
				home,
			});
			expect(result.code).toBe(1);
			expect(result.stderr).toContain("Couldn't reach http://127.0.0.1:9");
			expect(existsSync(configFile(home))).toBe(false);
		});

		test("a denied device login exits non-zero and saves nothing", async ({
			page,
		}) => {
			test.setTimeout(60_000);
			const deniedHome = freshHome();
			await signIn(page);

			const child = startCli(["login", "--base-url", E2E_BASE_URL], {
				home: deniedHome,
			});
			const done = collect(child);
			const url = await waitForOutput(child, /\(or open (\S+) to skip/);

			await page.goto(url);
			await page.getByRole("button", { name: "Deny" }).click();
			await expect(page.getByText("Login request denied.")).toBeVisible();

			const result = await done;
			expect(result.code).toBe(1);
			expect(result.stderr).toContain("Login request was denied.");
			expect(existsSync(configFile(deniedHome))).toBe(false);
		});

		test("device login approved in the browser saves an API key", async ({
			page,
		}) => {
			test.setTimeout(60_000);
			await signIn(page);

			const child = startCli(["login", "--base-url", E2E_BASE_URL], { home });
			const done = collect(child);
			const code = await waitForOutput(
				child,
				/Code: ([A-Z0-9]{4}-[A-Z0-9]{4})/,
			);

			await page.goto(`/cli-auth?code=${encodeURIComponent(code)}`);
			await expect(page.locator("#code")).toHaveValue(code);
			await page.getByRole("button", { name: "Approve" }).click();
			await expect(page.getByText("CLI login approved.")).toBeVisible();

			const result = await done;
			expect(result.code).toBe(0);
			expect(result.stdout).toContain(`Logged in to ${E2E_BASE_URL}.`);

			const file = configFile(home);
			expect(statSync(file).mode & 0o777).toBe(0o600);
			const saved = JSON.parse(readFileSync(file, "utf8"));
			expect(saved.baseUrl).toBe(E2E_BASE_URL);
			expect(saved.apiKey).toEqual(expect.any(String));
			apiKey = saved.apiKey;
		});

		test("stacks list shows a stack created through the API", async () => {
			const stack = await api<{ id: string }>(apiKey, "/stacks", {
				name: "CLI stack",
				slug: "cli-stack",
			});
			stackId = stack.id;

			const table = await cli(["stacks", "list"], { home });
			expect(table.code).toBe(0);
			expect(table.stdout).toMatch(/^id\s+name\s+slug/);
			expect(table.stdout).toContain(stack.id);
			expect(table.stdout).toContain("CLI stack");

			const json = await cli(
				["stacks", "list", "--json", "--search", "cli-stack"],
				{ home },
			);
			expect(json.code).toBe(0);
			const rows = JSON.parse(json.stdout) as { slug: string }[];
			expect(rows.map((r) => r.slug)).toEqual(["cli-stack"]);

			const none = await cli(
				["stacks", "list", "--search", "no-such-stack-anywhere"],
				{ home },
			);
			expect(none.code).toBe(0);
			expect(none.stdout.trim()).toBe("(none)");
		});

		test("services created through the API are listed, paged and fetched", async () => {
			const created = await Promise.all(
				["cli-svc-one", "cli-svc-two"].map((slug) =>
					api<{ id: string }>(apiKey, "/services", {
						containerPort: 80,
						image: "nginx",
						name: slug,
						slug,
						stackId,
						tag: "alpine",
					}),
				),
			);
			serviceIds = created.map((s) => s.id);

			const table = await cli(["services", "list", "--search", "cli-svc"], {
				home,
			});
			expect(table.code).toBe(0);
			expect(table.stdout).toMatch(/^id\s+name\s+slug\s+status\s+image/);
			expect(table.stdout).toContain("cli-svc-one");
			expect(table.stdout).toContain("cli-svc-two");
			expect(table.stdout).toContain("nginx:alpine");
			expect(table.stdout).not.toContain("Showing");

			const firstPage = await cli(
				["services", "list", "--search", "cli-svc", "--per-page", "1"],
				{ home },
			);
			expect(firstPage.code).toBe(0);
			expect(firstPage.stdout).toContain(
				"Showing 1 of 2 (page 1 of 2). Use --page/--per-page for the rest.",
			);

			const pages = await Promise.all(
				["1", "2"].map((page) =>
					cli(
						[
							"services",
							"list",
							"--json",
							"--search",
							"cli-svc",
							"--per-page",
							"1",
							"--page",
							page,
						],
						{ home },
					),
				),
			);
			const paged = pages.flatMap(
				(p) => JSON.parse(p.stdout) as { id: string }[],
			);
			expect(paged.map((s) => s.id).sort()).toEqual([...serviceIds].sort());

			const got = await cli(["services", "get", serviceIds[0]], { home });
			expect(got.code).toBe(0);
			const svc = JSON.parse(got.stdout);
			expect(svc).toMatchObject({
				containerPort: 80,
				id: serviceIds[0],
				image: "nginx",
				stackId,
				tag: "alpine",
			});
		});

		test("services scans on a never-scanned service", async () => {
			const table = await cli(["services", "scans", serviceIds[0]], { home });
			expect(table.code).toBe(0);
			expect(table.stdout.trim()).toBe("(none)");

			const json = await cli(
				["services", "scans", "list", serviceIds[0], "--json"],
				{ home },
			);
			expect(json.code).toBe(0);
			expect(JSON.parse(json.stdout)).toEqual([]);

			const latest = await cli(["services", "scans", "get", serviceIds[0]], {
				home,
			});
			expect(latest.code).toBe(1);
			expect(latest.stderr).toMatch(
				/^error: 404 .*This service hasn't been scanned yet/,
			);

			const queued = await cli(["services", "scan", serviceIds[0]], { home });
			expect(queued.code).toBe(1);
			expect(queued.stderr).toMatch(/^error: 400 .*Deploy the service first/);

			const unknown = await cli(["services", "scans", "does-not-exist"], {
				home,
			});
			expect(unknown.code).toBe(1);
			expect(unknown.stderr).toMatch(/^error: 404 .*Not found/);
		});

		test("templates list includes the builtin catalogue", async () => {
			const json = await cli(["templates", "list", "--json"], { home });
			expect(json.code).toBe(0);
			const templates = JSON.parse(json.stdout) as {
				id: string;
				name: string;
			}[];
			expect(templates.length).toBeGreaterThan(0);

			const table = await cli(["templates", "list"], { home });
			expect(table.code).toBe(0);
			expect(table.stdout).toMatch(/^id\s+name\s+image/);
			expect(table.stdout).toContain(templates[0].name);
		});

		test("flags and env vars override the saved login", async () => {
			const bareHome = freshHome();

			const viaEnv = await cli(["stacks", "list", "--json"], {
				env: { HOMERUN_API_KEY: apiKey, HOMERUN_BASE_URL: E2E_BASE_URL },
				home: bareHome,
			});
			expect(viaEnv.code).toBe(0);
			expect(JSON.parse(viaEnv.stdout)).toEqual(
				expect.arrayContaining([expect.objectContaining({ id: stackId })]),
			);

			const viaFlags = await cli(
				[
					"services",
					"get",
					serviceIds[1],
					"--base-url",
					`${E2E_BASE_URL}/`,
					"--api-key",
					apiKey,
				],
				{ home: bareHome },
			);
			expect(viaFlags.code).toBe(0);
			expect(JSON.parse(viaFlags.stdout).id).toBe(serviceIds[1]);

			const badKey = await cli(
				["--api-key", "not-a-real-key", "services", "list"],
				{ home },
			);
			expect(badKey.code).toBe(1);
			expect(badKey.stderr).toMatch(/^error: 401 /);
			expect(badKey.stdout).toBe("");
		});

		test("unknown ids fail with the API's 404", async () => {
			const got = await cli(["services", "get", "does-not-exist"], { home });
			expect(got.code).toBe(1);
			expect(got.stderr).toMatch(/^error: 404 .*Not found/);

			const deploy = await cli(["services", "deploy", "does-not-exist"], {
				home,
			});
			expect(deploy.code).toBe(1);
			expect(deploy.stderr).toMatch(/^error: 404 .*Not found/);
		});

		test("logout revokes the API key and clears the saved login", async () => {
			const out = await cli(["logout"], { home });
			expect(out.code).toBe(0);
			expect(out.stdout).toContain(
				`Logged out of ${E2E_BASE_URL} and revoked the API key.`,
			);
			expect(existsSync(configFile(home))).toBe(false);

			const stale = await fetch(`${E2E_BASE_URL}/api/v1/services`, {
				headers: { "x-api-key": apiKey },
			});
			expect(stale.status).toBe(401);

			const again = await cli(["logout"], { home });
			expect(again.code).toBe(0);
			expect(again.stdout).toContain("Not logged in.");

			const list = await cli(["stacks", "list"], { home });
			expect(list.code).toBe(1);
			expect(list.stderr).toContain("Not logged in.");
		});
	});
