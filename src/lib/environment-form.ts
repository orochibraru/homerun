import { parseDotEnv } from "#lib/env-parse.js";
import { DOMAIN_RE } from "#lib/service-domains.js";

/**
 * An environment's source, domain and variable overrides from the
 * environments form (`ref`, `domain`, `envOverrides` as KEY=value lines),
 * or why they can't be used.
 */
export function environmentFormInput(formData: FormData):
	| {
			input: {
				domain: string | null;
				envOverrides: Record<string, string>;
				ref: string;
			};
	  }
	| { error: string } {
	const ref = String(formData.get("ref") ?? "").trim();
	const domain = String(formData.get("domain") ?? "")
		.trim()
		.toLowerCase();
	if (!ref) {
		return { error: "Pick the branch or tag this environment runs." };
	}
	if (domain && !DOMAIN_RE.test(domain)) {
		return { error: `${domain} isn't a hostname.` };
	}
	const envOverrides = Object.fromEntries(
		parseDotEnv(String(formData.get("envOverrides") ?? "")).map((row) => [
			row.key,
			row.value,
		]),
	);
	return { input: { domain: domain || null, envOverrides, ref } };
}
