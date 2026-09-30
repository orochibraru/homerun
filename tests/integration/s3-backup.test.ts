import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import process from "node:process";
import { SQL } from "bun";
import {
	backupRoundTrip,
	insertDestination,
	testDestination,
} from "./support/backups";
import { integrationContext } from "./support/context";

/** The endpoint as a URL, https assumed when it's given as a bare host. */
function withScheme(endpoint: string): string {
	return !endpoint || endpoint.includes("://")
		? endpoint
		: `https://${endpoint}`;
}

const env = {
	accessKeyId: process.env.HOMERUN_TEST_S3_ACCESS_KEY_ID ?? "",
	bucket: process.env.HOMERUN_TEST_S3_BUCKET ?? "",
	endpoint: withScheme(process.env.HOMERUN_TEST_S3_ENDPOINT ?? ""),
	prefix: process.env.HOMERUN_TEST_S3_PREFIX || "homerun-it",
	region: process.env.HOMERUN_TEST_S3_REGION || "us-east-1",
	secretAccessKey: process.env.HOMERUN_TEST_S3_SECRET_ACCESS_KEY ?? "",
	sizeMb: Number(process.env.HOMERUN_TEST_S3_SIZE_MB || 96),
};

const configured = Boolean(
	env.endpoint && env.bucket && env.accessKeyId && env.secretAccessKey,
);

let sql: SQL;

describe.skipIf(!configured)("S3 volume backups against a real bucket", () => {
	beforeAll(() => {
		sql = new SQL(integrationContext().databaseUrl);
	});

	afterAll(async () => {
		await sql?.close();
	});

	test(
		"backs a volume up and restores it byte for byte",
		async () => {
			await backupRoundTrip(
				sql,
				{
					accessKeyId: env.accessKeyId,
					bucket: env.bucket,
					endpoint: env.endpoint,
					region: env.region,
					secret: env.secretAccessKey,
					type: "s3",
				},
				env.prefix,
				env.sizeMb,
			);
		},
		40 * 60_000,
	);

	test("the destination test writes to the bucket and cleans up", async () => {
		const result = await testDestination(
			await insertDestination(sql, {
				accessKeyId: env.accessKeyId,
				bucket: env.bucket,
				endpoint: env.endpoint,
				region: env.region,
				secret: env.secretAccessKey,
				type: "s3",
			}),
		);
		expect(result.type).toBe("success");
	}, 120_000);
});
