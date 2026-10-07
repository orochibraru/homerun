import { describe, expect, test } from "bun:test";

const { highlightCode } = await import("../../../src/lib/server/shiki");
const { providerSnippets } = await import(
	"../../../src/lib/iac/provider-snippets"
);

describe("highlightCode", () => {
	test("highlights HCL with both themes as variables and escapes the source", async () => {
		const html = await highlightCode('resource "x" "y" { a = "<b>" }', "hcl");
		expect(html).toStartWith('<pre class="shiki');
		expect(html).toContain("--shiki-dark:");
		expect(html).toContain("--shiki-light:");
		expect(html).toContain("&#x3C;b>");
		expect(html).not.toContain("<b>");
	});

	test("plain text passes through escaped", async () => {
		expect(await highlightCode("a < b", "text")).toContain("a &#x3C; b");
	});
});

describe("providerSnippets", () => {
	test("fills in the instance's URL and installs the provider from the registry", () => {
		const snippets = providerSnippets("https://h.example.com");
		expect(snippets.map((snippet) => snippet.language)).toEqual([
			"shellscript",
			"shellscript",
			"typescript",
		]);
		expect(snippets[0].code).toContain(
			"HOMERUN_ENDPOINT=https://h.example.com",
		);
		expect(snippets[1].code).toContain(
			"pulumi package add terraform-provider orochibraru/homerun",
		);
		expect(snippets.map((snippet) => snippet.code).join("\n")).not.toContain(
			"terraformrc",
		);
	});
});
