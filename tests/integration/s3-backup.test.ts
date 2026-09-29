import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import process from "node:process";
import { SQL } from "bun";
import { nativeFetch, TEST_AUTH_SECRET } from "./support/config";
import { integrationContext } from "./support/context";

const env = {
	accessKeyId: process.env.HOMERUN_TEST_S3_ACCESS_KEY_ID ?? "",
	bucket: process.env.HOMERUN_TEST_S3_BUCKET ?? "",
	endpoint: process.env.HOMERUN_TEST_S3_ENDPOINT ?? "",
	prefix: process.env.HOMERUN_TEST_S3_PREFIX || "homerun-it",
	region: process.env.HOMERUN_TEST_S3_REGION || "us-east-1",
	secretAccessKey: process.env.HOMERUN_TEST_S3_SECRET_ACCESS_KEY ?? "",
	sizeMb: Number(process.env.HOMERUN_TEST_S3_SIZE_MB || 96),
};

const configured = Boolean(
	env.endpoint && env.bucket && env.accessKeyId && env.secretAccessKey,
);

let sql: SQL;
const dockerVolumes: string[] = [];

/** The app's own secret encryption, so the destination row decrypts like one saved from the form. */
function encryptSecret(plaintext: string): string {
	const iv = randomBytes(12);
	const cipher = createCipheriv(
		"aes-256-gcm",
		scryptSync(TEST_AUTH_SECRET, "homerun-registry-secrets", 32),
		iv,
	);
	const ciphertext = Buffer.concat([
		cipher.update(plaintext, "utf8"),
		cipher.final(),
	]);
	return [iv, cipher.getAuthTag(), ciphertext]
		.map((buf) => buf.toString("base64"))
		.join(".");
}

/** Runs docker and returns its trimmed stdout, throwing with stderr on failure. */
function docker(...args: string[]): string {
	const run = Bun.spawnSync(["docker", ...args]);
	if (run.exitCode !== 0) {
		throw new Error(`docker ${args.join(" ")}: ${run.stderr.toString()}`);
	}
	return run.stdout.toString().trim();
}

/** A sha256 per file of a volume, sorted by path, read through a throwaway container. */
function manifest(volume: string): string {
	return docker(
		"run",
		"--rm",
		"-v",
		`${volume}:/d:ro`,
		"alpine:3",
		"sh",
		"-c",
		"cd /d && find . -type f -exec sha256sum {} + | sort -k2",
	);
}

/** Polls check every 2s until it returns something other than null. */
async function until<T>(
	what: string,
	check: () => Promise<T | null>,
	timeoutMs = 20 * 60_000,
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		const value = await check();
		if (value !== null) {
			return value;
		}
		await Bun.sleep(2000);
	}
	throw new Error(`Timed out waiting for ${what}`);
}

/** Waits for the newest backup_run of a kind on a volume to finish, failing the test on a failed run. */
async function finishedRun(
	volumeId: string,
	kind: "backup" | "restore",
	after: Date,
): Promise<{ key: string | null; seconds: number; sizeBytes: number | null }> {
	return await until(`the ${kind}`, async () => {
		const [run] =
			await sql`select success, error, key, size_bytes, started_at, finished_at
			from backup_run where volume_id = ${volumeId} and kind = ${kind} and started_at >= ${after}
			order by started_at desc limit 1`;
		if (!run || run.success === null) {
			return null;
		}
		if (!run.success) {
			throw new Error(`${kind} failed: ${run.error}`);
		}
		return {
			key: run.key,
			seconds:
				(new Date(run.finished_at).getTime() -
					new Date(run.started_at).getTime()) /
				1000,
			sizeBytes: run.size_bytes === null ? null : Number(run.size_bytes),
		};
	});
}

describe.skipIf(!configured)("S3 volume backups against a real bucket", () => {
	beforeAll(() => {
		sql = new SQL(integrationContext().databaseUrl);
	});

	afterAll(async () => {
		for (const name of dockerVolumes) {
			Bun.spawnSync(["docker", "volume", "rm", "-f", name]);
		}
		await sql?.close();
	});

	test(
		"backs a volume up and restores it byte for byte",
		async () => {
			const { apiKey, origin, userId } = integrationContext();
			const suffix = Date.now().toString(36);
			const source = `homerun-it-s3-${suffix}`;
			dockerVolumes.push(source);
			docker("volume", "create", source);
			docker(
				"run",
				"--rm",
				"-v",
				`${source}:/d`,
				"alpine:3",
				"sh",
				"-c",
				`mkdir -p /d/nested && echo hello > /d/hello.txt && ln -s hello.txt /d/link && head -c ${env.sizeMb}m /dev/urandom > /d/nested/random.bin && chown 999:999 /d/hello.txt`,
			);
			const before = manifest(source);

			const destinationId = crypto.randomUUID();
			const volumeId = crypto.randomUUID();
			const now = new Date();
			await sql`insert into s3_destination (id, name, endpoint, region, bucket, access_key_id, secret_access_key_enc, user_id, created_at, updated_at)
				values (${destinationId}, ${`it-${suffix}`}, ${env.endpoint}, ${env.region}, ${env.bucket}, ${env.accessKeyId}, ${encryptSecret(env.secretAccessKey)}, ${userId}, ${now}, ${now})`;
			await sql`insert into storage_volume (id, name, kind, source, s3_destination_id, backup_prefix, user_id, created_at, updated_at)
				values (${volumeId}, ${`s3-${suffix}`}, 'volume', ${source}, ${destinationId}, ${`${env.prefix}/${suffix}`}, ${userId}, ${now}, ${now})`;

			const started = new Date();
			const backup = await nativeFetch(
				`${origin}/api/v1/volumes/${volumeId}/backup`,
				{ headers: { "x-api-key": apiKey }, method: "POST" },
			);
			expect(backup.status).toBeLessThan(300);
			const backedUp = await finishedRun(volumeId, "backup", started);
			expect(backedUp.key).toStartWith(`${env.prefix}/${suffix}/`);
			console.info(
				`Backup of ${env.sizeMb} MiB: ${((backedUp.sizeBytes ?? 0) / 2 ** 20).toFixed(1)} MiB archive in ${backedUp.seconds}s`,
			);

			docker(
				"run",
				"--rm",
				"-v",
				`${source}:/d`,
				"alpine:3",
				"sh",
				"-c",
				"rm -rf /d/* && echo changed > /d/hello.txt",
			);
			expect(manifest(source)).not.toBe(before);

			const restoreStarted = new Date();
			const restore = await nativeFetch(
				`${origin}/storage/${volumeId}?/restore`,
				{
					body: new URLSearchParams({ key: backedUp.key ?? "", wipe: "on" }),
					headers: {
						"content-type": "application/x-www-form-urlencoded",
						origin,
						"x-api-key": apiKey,
						"x-sveltekit-action": "true",
					},
					method: "POST",
				},
			);
			expect(restore.status).toBeLessThan(300);
			const restored = await finishedRun(volumeId, "restore", restoreStarted);
			console.info(`Restore took ${restored.seconds}s`);

			expect(manifest(source)).toBe(before);
			expect(
				docker(
					"run",
					"--rm",
					"-v",
					`${source}:/d:ro`,
					"alpine:3",
					"stat",
					"-c",
					"%u %N",
					"/d/hello.txt",
					"/d/link",
				),
			).toBe("999 /d/hello.txt\n0 '/d/link' -> 'hello.txt'");
		},
		40 * 60_000,
	);
});
