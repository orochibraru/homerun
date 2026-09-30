import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import process from "node:process";
import { SQL } from "bun";
import {
	backupRoundTrip,
	insertDestination,
	type TestDestination,
	testDestination,
} from "./support/backups";
import { integrationContext } from "./support/context";

const SFTP_PORT = "23";
const SMB_SHARE = "backup";

const env = {
	location: (process.env.HETZNER_STORAGEBOX_LOCATION ?? "").replace(
		/^\/+|\/+$/g,
		"",
	),
	password: process.env.HETZNER_STORAGEBOX_PASSWORD ?? "",
	sizeMb: Number(process.env.HETZNER_STORAGEBOX_SIZE_MB || 16),
	url: process.env.HETZNER_STORAGEBOX_URL ?? "",
	username: process.env.HETZNER_STORAGEBOX_USERNAME ?? "",
};

const configured = Boolean(env.url && env.username && env.password);

const TYPES = ["sftp", "smb", "webdav"] as const;

/** The box as a destination row of one type: WebDAV keeps the URL, SFTP and SMB take its host, SFTP on port 23 and SMB under the box's `backup` share. */
function destination(type: (typeof TYPES)[number]): TestDestination {
	const host = env.url.replace(/^[a-z]+:\/\//, "").replace(/\/.*$/, "");
	const shared = {
		accessKeyId: env.username,
		region: "",
		secret: env.password,
	};
	if (type === "sftp") {
		return {
			...shared,
			bucket: env.location,
			endpoint: host.includes(":") ? host : `${host}:${SFTP_PORT}`,
			type: "sftp",
		};
	}
	if (type === "smb") {
		return {
			...shared,
			bucket: [SMB_SHARE, env.location].filter(Boolean).join("/"),
			endpoint: host,
			type: "smb",
		};
	}
	return {
		...shared,
		bucket: env.location,
		endpoint: env.url.replace(/\/+$/, ""),
		type: "webdav",
	};
}

let sql: SQL;

describe.skipIf(!configured)("volume backups to a Hetzner Storage Box", () => {
	beforeAll(() => {
		sql = new SQL(integrationContext().databaseUrl);
	});

	afterAll(async () => {
		await sql?.close();
	});

	for (const type of TYPES) {
		test(`${type}: the destination test reaches the box and writes to it`, async () => {
			const result = await testDestination(
				await insertDestination(sql, destination(type)),
			);
			expect(result).toMatchObject({ type: "success" });
		}, 120_000);

		test(
			`${type}: backs a volume up and restores it byte for byte`,
			async () => {
				await backupRoundTrip(
					sql,
					destination(type),
					`homerun-it/${type}`,
					env.sizeMb,
				);
			},
			40 * 60_000,
		);
	}
});
