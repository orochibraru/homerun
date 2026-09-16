import { describe, expect, test } from "bun:test";
import { BUILTIN_TEMPLATES_APPS } from "$lib/server/db/builtin-templates-apps";
import { dockerHealthcheck } from "$lib/services/docker/healthcheck";

describe("dockerHealthcheck", () => {
	test("blank keeps the image's own healthcheck", () => {
		expect(dockerHealthcheck(null)).toBeUndefined();
		expect(dockerHealthcheck("   ")).toBeUndefined();
	});

	test("wraps the command in CMD-SHELL", () => {
		expect(dockerHealthcheck(" test -f /tmp/ok ")?.Test).toEqual([
			"CMD-SHELL",
			"test -f /tmp/ok",
		]);
	});

	test("the Newt command only passes on a connected websocket", async () => {
		const newt = BUILTIN_TEMPLATES_APPS.find((t) => t.id === "builtin-newt");
		const command = newt?.healthcheckCommand ?? "";
		const grep = command.slice(command.indexOf("grep"));
		const run = async (metrics: string) => {
			const proc = Bun.spawn(["sh", "-c", grep], { stdin: "pipe" });
			proc.stdin.write(metrics);
			proc.stdin.end();
			return await proc.exited;
		};
		expect(await run('newt_websocket_connected{site_id="abc"} 1\n')).toBe(0);
		expect(await run("newt_websocket_connected 1\n")).toBe(0);
		expect(await run('newt_websocket_connected{site_id="abc"} 0\n')).not.toBe(
			0,
		);
	});
});
