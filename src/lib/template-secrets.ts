import type { ServiceRuntimeOptions } from "$lib/service-runtime";

export const SECRET_TOKEN = "{{secret}}";

/** A fresh random secret for a template's `{{secret}}`: 48 hex characters, safe unescaped in a URL, a shell word or a flag. */
export function generateTemplateSecret(): string {
	return Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

/** `envVars` with every `{{secret}}` in its values replaced by `secret`. */
export function fillSecretInEnv(
	envVars: Record<string, string>,
	secret: string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(envVars).map(([key, value]) => [
			key,
			value.replaceAll(SECRET_TOKEN, secret),
		]),
	);
}

/** `runtime` with every `{{secret}}` in its command and entrypoint replaced by `secret`. */
export function fillSecretInRuntime(
	runtime: ServiceRuntimeOptions,
	secret: string,
): ServiceRuntimeOptions {
	const fill = (argv: string[] | null) =>
		argv ? argv.map((arg) => arg.replaceAll(SECRET_TOKEN, secret)) : argv;
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
