import { describe, expect, test } from "bun:test";
import {
	IAC_TOOL_INFO,
	IAC_TOOLS,
	isIacTool,
	usesHttpBackend,
} from "../../../src/lib/iac/tools";

describe("isIacTool", () => {
	test("accepts the three tools and nothing else", () => {
		for (const tool of IAC_TOOLS) {
			expect(isIacTool(tool)).toBe(true);
		}
		expect(isIacTool("ansible")).toBe(false);
		expect(isIacTool("")).toBe(false);
		expect(isIacTool(null)).toBe(false);
	});
});

describe("usesHttpBackend", () => {
	test("Terraform and OpenTofu use Homerun's backend, Pulumi the bucket", () => {
		expect(usesHttpBackend("terraform")).toBe(true);
		expect(usesHttpBackend("opentofu")).toBe(true);
		expect(usesHttpBackend("pulumi")).toBe(false);
	});
});

describe("IAC_TOOL_INFO", () => {
	test("names each tool's command", () => {
		expect(IAC_TOOL_INFO.terraform.cli).toBe("terraform");
		expect(IAC_TOOL_INFO.opentofu.cli).toBe("tofu");
		expect(IAC_TOOL_INFO.pulumi.cli).toBe("pulumi");
	});
});
