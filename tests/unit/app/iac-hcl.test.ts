import { describe, expect, test } from "bun:test";
import {
	expression,
	quote,
	renderHcl,
	renderValue,
} from "../../../src/lib/iac/hcl";

describe("quote", () => {
	test("escapes quotes, backslashes, control characters and templates", () => {
		expect(quote('say "hi"\\')).toBe('"say \\"hi\\"\\\\"');
		expect(quote("a\tb\rc\nd")).toBe('"a\\tb\\rc\\nd"');
		expect(quote("\u0001")).toBe('"\\u0001"');
		expect(quote("${var.x} %{if}")).toBe('"$${var.x} %%{if}"');
	});
});

describe("renderValue", () => {
	test("renders scalars, expressions and short lists inline", () => {
		expect(renderValue(null)).toBe("null");
		expect(renderValue(3)).toBe("3");
		expect(renderValue(true)).toBe("true");
		expect(renderValue(expression("var.key"))).toBe("var.key");
		expect(renderValue(["a", 1])).toBe('["a", 1]');
		expect(renderValue({})).toBe("{}");
	});

	test("sorts map keys and quotes the ones that aren't identifiers", () => {
		expect(renderValue({ "b.example.com": 1, a: "x", long_name: 2 })).toBe(
			'{\n  a               = "x"\n  "b.example.com" = 1\n  long_name       = 2\n}',
		);
	});

	test("breaks a list of objects over lines", () => {
		expect(renderValue([{ port: 80 }])).toBe("[\n  {\n    port = 80\n  },\n]");
	});

	test("writes multi-line strings as heredocs that keep the value exact", () => {
		expect(renderValue("a\nb\n")).toBe("<<EOT\na\nb\nEOT");
		expect(renderValue("a\nb", "  ")).toBe("chomp(<<EOT\na\nb\nEOT\n  )");
		expect(renderValue("EOT\n${x}\n")).toBe("<<EOT_\nEOT\n$${x}\nEOT_");
	});
});

describe("renderHcl", () => {
	test("aligns consecutive attributes and separates blocks", () => {
		const text = renderHcl([
			{
				attributes: [],
				blocks: [
					{
						attributes: [["homerun", { source: "orochibraru/homerun" }]],
						labels: [],
						type: "required_providers",
					},
				],
				labels: [],
				type: "terraform",
			},
			{
				attributes: [
					["name", "Web"],
					["container_port", 80],
					["env_vars", { A: "1" }],
					["slug", "web"],
				],
				labels: ["homerun_service", "web"],
				type: "resource",
			},
			{ attributes: [], labels: [], type: "empty" },
		]);
		expect(text).toBe(
			[
				"terraform {",
				"  required_providers {",
				"    homerun = {",
				'      source = "orochibraru/homerun"',
				"    }",
				"  }",
				"}",
				"",
				'resource "homerun_service" "web" {',
				'  name           = "Web"',
				"  container_port = 80",
				"  env_vars = {",
				'    A = "1"',
				"  }",
				'  slug = "web"',
				"}",
				"",
				"empty {}",
				"",
			].join("\n"),
		);
	});
});

describe("heredoc alignment", () => {
	test("a plain heredoc joins the attributes above it, a chomp() one doesn't", () => {
		const text = renderHcl([
			{
				attributes: [
					["command", ["sh"]],
					["healthcheck_command", "exit 0\n"],
					["name", "Web"],
					["description", "a\nb"],
				],
				labels: [],
				type: "x",
			},
		]);
		expect(text).toBe(
			'x {\n  command             = ["sh"]\n  healthcheck_command = <<EOT\nexit 0\nEOT\n  name = "Web"\n  description = chomp(<<EOT\na\nb\nEOT\n  )\n}\n',
		);
	});
});
