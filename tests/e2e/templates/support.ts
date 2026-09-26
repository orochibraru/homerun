import { execFile } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { request } from "node:https";
import { join } from "node:path";
import process from "node:process";
import { promisify } from "node:util";

export const TRAEFIK_CONTAINER = "homerun-e2e-traefik";
export const TRAEFIK_PORT = Number(process.env.E2E_TRAEFIK_PORT ?? 4443);
export const AUTH_STATE = "test-results/templates-auth.json";
export const ADMIN = {
	email: "templates@example.com",
	name: "Template Tester",
	password: "a-real-strong-password-123",
};

const run = promisify(execFile);

export interface TemplateFile {
	category: string;
	image: string;
	links?: { alias: string; template: string }[];
	slug: string;
	tag: string;
}

/**
 * Runs a `docker` CLI command and returns its trimmed stdout.
 *
 * @throws Error carrying stderr when the command exits non-zero.
 */
export async function docker(
	args: string[],
	timeoutMs = 120_000,
): Promise<string> {
	try {
		const { stdout } = await run("docker", args, {
			maxBuffer: 32 * 1024 * 1024,
			timeout: timeoutMs,
		});
		return stdout.trim();
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr?.trim();
		throw new Error(
			`docker ${args.join(" ")} failed: ${stderr || String(error)}`,
		);
	}
}

/** Runs a `docker` command, returning null instead of throwing when it fails. */
export async function dockerQuiet(
	args: string[],
	timeoutMs?: number,
): Promise<string | null> {
	return await docker(args, timeoutMs).catch(() => null);
}

/** Every built-in template under the repo's `templates/<category>/<slug>.json`, sorted by slug. */
export function loadTemplates(): TemplateFile[] {
	const root = join(process.cwd(), "templates");
	return readdirSync(root, { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.flatMap((category) =>
			readdirSync(join(root, category.name))
				.filter((file) => file.endsWith(".json"))
				.map((file) => ({
					...(JSON.parse(
						readFileSync(join(root, category.name, file), "utf8"),
					) as Omit<TemplateFile, "category" | "slug">),
					category: category.name,
					slug: file.replace(/\.json$/, ""),
				})),
		)
		.sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * Sends one HTTPS GET to the e2e Traefik for `hostname`, with SNI and the Host
 * header set so the request is routed like a real browser's would be, and
 * Traefik's self-signed default certificate accepted.
 */
export function probeThroughTraefik(
	hostname: string,
): Promise<{ body: string; status: number }> {
	return new Promise((resolveProbe, reject) => {
		const req = request(
			{
				headers: { host: hostname },
				host: "127.0.0.1",
				method: "GET",
				path: "/",
				port: TRAEFIK_PORT,
				rejectUnauthorized: false,
				servername: hostname,
				timeout: 15_000,
			},
			(res) => {
				let body = "";
				res.setEncoding("utf8");
				res.on("data", (chunk: string) => {
					if (body.length < 2048) {
						body += chunk;
					}
				});
				res.on("end", () =>
					resolveProbe({ body, status: res.statusCode ?? 0 }),
				);
			},
		);
		req.on("timeout", () => req.destroy(new Error("timed out")));
		req.on("error", reject);
		req.end();
	});
}
