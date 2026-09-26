import type { ServiceRuntimeOptions } from "$lib/service-runtime";

export const SECRET_TOKEN = "{{secret}}";

const HEX_SECRET_TOKEN = /\{\{secret:hex([1-9]\d{0,2})\}\}/g;

/** `length` random hex characters. */
function randomHex(length: number): string {
	return Array.from(
		crypto.getRandomValues(new Uint8Array(Math.ceil(length / 2))),
		(byte) => byte.toString(16).padStart(2, "0"),
	)
		.join("")
		.slice(0, length);
}

/** A fresh random secret for a template's `{{secret}}`: 48 hex characters, safe unescaped in a URL, a shell word or a flag. */
export function generateTemplateSecret(): string {
	return randomHex(48);
}

/**
 * `value` with `{{secret}}` replaced by `secret` and each `{{secret:hex<N>}}`
 * by its own fresh N random hex characters (1 to 999), for apps that insist on
 * a key of an exact length and format.
 */
function fillSecret(value: string, secret: string): string {
	return value
		.replaceAll(SECRET_TOKEN, secret)
		.replace(HEX_SECRET_TOKEN, (_token, length: string) =>
			randomHex(Number(length)),
		);
}

/** Whether `value` holds a `{{secret}}` or `{{secret:hex<N>}}` token. */
function hasSecretToken(value: string): boolean {
	return (
		value.includes(SECRET_TOKEN) ||
		new RegExp(HEX_SECRET_TOKEN.source).test(value)
	);
}

/** Whether every `{{secret…}}` token in `value` is one `fillSecret` knows how to fill. */
export function secretTokensValid(value: string): boolean {
	return !value
		.replaceAll(SECRET_TOKEN, "")
		.replace(HEX_SECRET_TOKEN, "")
		.includes("{{secret");
}

/** `envVars` with every secret token in its values filled, see `fillSecret`. */
export function fillSecretInEnv(
	envVars: Record<string, string>,
	secret: string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(envVars).map(([key, value]) => [
			key,
			fillSecret(value, secret),
		]),
	);
}

/** The env var names a template fills from a secret token, which start out marked secret on the service it creates. */
export function secretEnvKeysOf(templateEnv: Record<string, string>): string[] {
	return Object.keys(templateEnv).filter((key) =>
		hasSecretToken(templateEnv[key] ?? ""),
	);
}

/** `runtime` with every secret token in its command and entrypoint filled, see `fillSecret`. */
export function fillSecretInRuntime(
	runtime: ServiceRuntimeOptions,
	secret: string,
): ServiceRuntimeOptions {
	const fill = (argv: string[] | null) =>
		argv ? argv.map((arg) => fillSecret(arg, secret)) : argv;
	return {
		...runtime,
		command: fill(runtime.command),
		entrypoint: fill(runtime.entrypoint),
	};
}

/**
 * The secret a service created from the wizard ended up with: the submitted
 * value of the first env var the template set to exactly `{{secret}}`, so a
 * password the operator edited in the form still matches the one its command
 * starts the server with. Null when the template has no such var or it was
 * left empty.
 */
export function submittedSecret(
	templateEnv: Record<string, string>,
	submittedEnv: Record<string, string>,
): string | null {
	const key = Object.keys(templateEnv).find(
		(name) => templateEnv[name] === SECRET_TOKEN,
	);
	return (key && submittedEnv[key]) || null;
}
