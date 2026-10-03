import { describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { brandedEmail, escapeHtml } = await import(
	"../../../src/lib/server/email-layout"
);

describe("brandedEmail", () => {
	test("renders every block in both the HTML and the text version", () => {
		config.auth.origin = "https://homerun.example.com";
		const mail = brandedEmail({
			action: { label: "Open", url: "https://homerun.example.com/x?a=1&b=2" },
			code: "123456",
			details: [{ name: "Service", value: "api" }],
			footnote: "Ignore this if it wasn't you.",
			heading: "Hello",
			paragraphs: ["First line."],
			pre: "stack trace",
		});
		for (const part of [
			"Hello",
			"First line.",
			"123456",
			"api",
			"stack trace",
		]) {
			expect(mail.html).toContain(part);
			expect(mail.content).toContain(part);
		}
		expect(mail.html).toContain(
			'href="https://homerun.example.com/x?a=1&amp;b=2"',
		);
		expect(mail.html).toContain("https://homerun.example.com/logo.png");
		expect(mail.content).toContain(
			"Open: https://homerun.example.com/x?a=1&b=2",
		);
		expect(mail.content).toContain("Service: api");
	});

	test("escapes whatever it's given, and skips the logo with no public origin", () => {
		config.auth.origin = "";
		const mail = brandedEmail({
			heading: "<script>alert(1)</script>",
			paragraphs: ['"quoted" & <b>bold</b>'],
		});
		expect(mail.html).not.toContain("<script>");
		expect(mail.html).toContain("&lt;script&gt;");
		expect(mail.html).toContain("&quot;quoted&quot; &amp; &lt;b&gt;");
		expect(mail.html).not.toContain("logo.png");
		expect(escapeHtml("'")).toBe("&#39;");
	});
});
