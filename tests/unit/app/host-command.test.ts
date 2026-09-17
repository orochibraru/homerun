import { describe, expect, test } from "bun:test";
import { hostCommandArgs } from "../../../src/lib/services/docker/host-command";

describe("hostCommandArgs", () => {
	test("enters every namespace of the host's PID 1 and hands the command to sh as one argument", () => {
		const args = hostCommandArgs("df -h / && echo 'done'");
		expect(args.slice(0, 3)).toEqual(["nsenter", "-t", "1"]);
		expect(args).toContain("-m");
		expect(args).toContain("-n");
		expect(args).toContain("-p");
		expect(args.slice(-4)).toEqual([
			"--",
			"sh",
			"-c",
			"df -h / && echo 'done'",
		]);
	});
});
