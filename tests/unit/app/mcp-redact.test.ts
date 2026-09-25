import { describe, expect, test } from "bun:test";
import {
	REDACTED,
	redactSecrets,
	redactText,
	restoreRedacted,
} from "../../../src/lib/server/mcp-redact";

describe("MCP secret redaction", () => {
	test("masks env values in a service record and its config, and drops encrypted fields", () => {
		const redacted = redactSecrets({
			env: { files: ["/x.env"], vars: { ADMIN_KEY: "s3cret" } },
			envVars: { POSTGRES_PASSWORD: "hunter2" },
			name: "app",
			registryPasswordEnc: "enc",
			source: { registry: { passwordSet: true } },
		});
		expect(redacted).toEqual({
			env: { files: ["/x.env"], vars: { ADMIN_KEY: REDACTED } },
			envVars: { POSTGRES_PASSWORD: REDACTED },
			name: "app",
			source: { registry: { passwordSet: true } },
		});
		expect(JSON.stringify(redacted)).not.toContain("s3cret");
	});

	test("redacts a JSON body and leaves any other text alone", () => {
		expect(redactText('{"envVars":{"K":"v"}}')).toBe(
			`{"envVars":{"K":"${REDACTED}"}}`,
		);
		expect(redactText("Unauthorized")).toBe("Unauthorized");
	});

	test("an echoed placeholder keeps the stored value, a new value wins", () => {
		expect(
			restoreRedacted(
				{ ADMIN_KEY: REDACTED, NEW: REDACTED, TZ: "Europe/Paris" },
				{ ADMIN_KEY: "s3cret", TZ: "UTC" },
			),
		).toEqual({ ADMIN_KEY: "s3cret", NEW: REDACTED, TZ: "Europe/Paris" });
	});
});
