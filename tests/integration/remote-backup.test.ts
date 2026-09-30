import { afterAll, beforeAll, describe, test } from "bun:test";
import { SQL } from "bun";
import { backupRoundTrip, docker } from "./support/backups";
import { integrationContext } from "./support/context";

const RCLONE_IMAGE = "rclone/rclone:1.75.1";
const SERVER = `homerun-it-sftp-${Date.now().toString(36)}`;
const PASSWORD = 'pa ss"w0rd-$x';

let sql: SQL;
let address = "";

describe("volume backups to an SFTP server through rclone", () => {
	beforeAll(async () => {
		sql = new SQL(integrationContext().databaseUrl);
		docker(
			"run",
			"-d",
			"--name",
			SERVER,
			RCLONE_IMAGE,
			"serve",
			"sftp",
			"/data",
			"--addr",
			":2022",
			"--user",
			"bob",
			"--pass",
			PASSWORD,
		);
		address = docker(
			"inspect",
			"-f",
			"{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
			SERVER,
		);
		const deadline = Date.now() + 30_000;
		while (
			!Bun.spawnSync(["docker", "logs", SERVER]).stderr.includes("listening")
		) {
			if (Date.now() > deadline) {
				throw new Error("The SFTP server never started listening");
			}
			await Bun.sleep(250);
		}
	}, 120_000);

	afterAll(async () => {
		Bun.spawnSync(["docker", "rm", "-f", SERVER]);
		await sql?.close();
	});

	test(
		"backs a volume up and restores it byte for byte",
		async () => {
			await backupRoundTrip(
				sql,
				{
					accessKeyId: "bob",
					bucket: "backups",
					endpoint: `${address}:2022`,
					region: "",
					secret: PASSWORD,
					type: "sftp",
				},
				"homerun-it",
				16,
			);
		},
		10 * 60_000,
	);
});
