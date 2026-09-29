import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SQL } from "bun";
import { nativeFetch } from "./support/config";
import { integrationContext } from "./support/context";

const CONTAINER = `homerun-it-sshd-${process.pid}`;
const SSHD_IMAGE = "lscr.io/linuxserver/openssh-server:latest";
const PORT = 12_222;
let sql: SQL;

/** A request to the app as the run's admin, through its API key. */
function app(
	path: string,
	init: Omit<RequestInit, "headers"> & {
		headers?: Record<string, string>;
	} = {},
): Promise<Response> {
	const { apiKey, origin } = integrationContext();
	return nativeFetch(`${origin}${path}`, {
		...init,
		headers: { ...init.headers, origin, "x-api-key": apiKey },
	});
}

beforeAll(async () => {
	sql = new SQL(integrationContext().databaseUrl);
	await sql`update instance_settings set onboarding_completed_at = coalesce(onboarding_completed_at, now())`;
});

afterAll(async () => {
	Bun.spawnSync(["docker", "rm", "-f", CONTAINER]);
	await sql`update instance_settings set ssh_host = null, ssh_user = null, ssh_port = null, ssh_host_key = null`;
	await sql.close();
});

describe("machine terminals", () => {
	test("opens a shell over SSH with Homerun's key and records the host key", async () => {
		expect((await app("/terminal")).status).toBe(200);
		const [row] = await sql`select ssh_public_key from instance_settings`;
		const publicKey = row.ssh_public_key as string;
		expect(publicKey).toStartWith("ssh-ed25519 ");

		Bun.spawnSync(["docker", "rm", "-f", CONTAINER]);
		let pulled = Bun.spawnSync(["docker", "pull", "-q", SSHD_IMAGE]);
		for (let attempt = 1; attempt < 3 && !pulled.success; attempt++) {
			await Bun.sleep(attempt * 10_000);
			pulled = Bun.spawnSync(["docker", "pull", "-q", SSHD_IMAGE]);
		}
		expect(pulled.success, pulled.stderr.toString()).toBe(true);
		const started = Bun.spawnSync([
			"docker",
			"run",
			"-d",
			"--name",
			CONTAINER,
			"-p",
			`127.0.0.1:${PORT}:2222`,
			"-e",
			`PUBLIC_KEY=${publicKey}`,
			"-e",
			"USER_NAME=homerun",
			SSHD_IMAGE,
		]);
		expect(started.success, started.stderr.toString()).toBe(true);
		await sql`update instance_settings set ssh_host = '127.0.0.1', ssh_port = ${PORT}, ssh_user = 'homerun', ssh_host_key = null`;

		let opened = new Response(null, { status: 599 });
		for (let attempt = 0; attempt < 30; attempt++) {
			opened = await app("/terminal/local/open", {
				body: JSON.stringify({ cols: 100, rows: 30 }),
				headers: { "content-type": "application/json" },
				method: "POST",
			});
			if (opened.ok) {
				break;
			}
			await Bun.sleep(1000);
		}
		expect(opened.status).toBe(200);
		const { sessionId } = (await opened.json()) as { sessionId: string };

		const stream = await app(`/terminal/session/${sessionId}/stream`);
		expect(stream.ok).toBe(true);
		const reader = stream.body?.getReader();
		await app(`/terminal/session/${sessionId}/input`, {
			body: "echo hello-from-$((6*7))\n",
			headers: { "content-type": "text/plain" },
			method: "POST",
		});
		let output = "";
		const deadline = Date.now() + 15_000;
		while (!output.includes("hello-from-42") && Date.now() < deadline) {
			const chunk = await reader?.read();
			if (!chunk || chunk.done) {
				break;
			}
			output += new TextDecoder().decode(chunk.value);
		}
		expect(output).toContain("hello-from-42");
		await reader?.cancel();
		await app(`/terminal/session/${sessionId}/close`, { method: "POST" });

		const [after] = await sql`select ssh_host_key from instance_settings`;
		expect(after.ssh_host_key as string).toMatch(/^(ssh|ecdsa)-\S+ \S+$/);
	}, 120_000);
});
