export const REDACTED = "[redacted]";

const ENV_MAP_KEYS = new Set(["envVars", "vars"]);
const ARGV_KEYS = new Set(["command", "entrypoint"]);

const SECRET_NAME_PARTS = new Set([
	"APIKEY",
	"CREDENTIAL",
	"CREDENTIALS",
	"KEY",
	"PASS",
	"PASSPHRASE",
	"PASSWD",
	"PASSWORD",
	"PRIVATE",
	"PWD",
	"SALT",
	"SECRET",
	"TOKEN",
]);

const URL_PASSWORD_RE = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)([^\s@/]+)@/gi;
const SECRET_FLAG_RE =
	/(--(?:requirepass|password|pass|masterauth)(?:=|\s+))('[^']*'|"[^"]*"|\S+)/gi;
const SECRET_FLAGS = new Set([
	"--masterauth",
	"--pass",
	"--password",
	"--requirepass",
]);

/**
 * Whether an env var's name says it holds a secret: one of its `_`/`-`/`.`
 * separated parts (or its camelCase words) is PASS, PASSWORD, SECRET, TOKEN,
 * KEY, CREDENTIAL, PRIVATE, SALT or the like. `TZ`, `PORT`, `SSH_PORT` and
 * `LOG_LEVEL` stay readable, which diagnosing a service needs.
 */
export function isSecretName(name: string): boolean {
	return name
		.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
		.toUpperCase()
		.split(/[^A-Z0-9]+/)
		.some((part) => SECRET_NAME_PARTS.has(part));
}

/** A value with every URL's password and every `--requirepass`/`--password` argument masked, the rest left readable. */
export function maskInlineSecrets(value: string): string {
	return value
		.replace(URL_PASSWORD_RE, `$1${REDACTED}@`)
		.replace(SECRET_FLAG_RE, `$1${REDACTED}`);
}

/** One env var's value as an agent sees it: fully masked under a secret-looking name, otherwise only its inline secrets. */
export function redactEnvValue(name: string, value: string): string {
	return isSecretName(name) ? REDACTED : maskInlineSecrets(value);
}

/** An argv with the argument after a password flag, and every inline secret, masked. */
function redactArgv(argv: unknown[]): unknown[] {
	return argv.map((arg, i) => {
		if (typeof arg !== "string") {
			return arg;
		}
		const previous = argv[i - 1];
		return typeof previous === "string" &&
			SECRET_FLAGS.has(previous.toLowerCase())
			? REDACTED
			: maskInlineSecrets(arg);
	});
}

/**
 * A copy of an API body safe to hand an agent: env values masked by name
 * (secret-looking names fully, any other value only its URL passwords and
 * password flags), password arguments masked in commands, and every
 * encrypted `…Enc` field dropped, however deep they sit.
 */
export function redactSecrets(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(redactSecrets);
	}
	if (!value || typeof value !== "object") {
		return value;
	}
	const out: Record<string, unknown> = {};
	for (const [key, inner] of Object.entries(value)) {
		if (key.endsWith("Enc")) {
			continue;
		}
		if (ENV_MAP_KEYS.has(key) && inner && typeof inner === "object") {
			out[key] = Object.fromEntries(
				Object.entries(inner).map(([name, envValue]) => [
					name,
					typeof envValue === "string"
						? redactEnvValue(name, envValue)
						: envValue,
				]),
			);
		} else if (ARGV_KEYS.has(key) && Array.isArray(inner)) {
			out[key] = redactArgv(inner);
		} else {
			out[key] = redactSecrets(inner);
		}
	}
	return out;
}

/** A body's text with its secrets redacted when it's JSON, only its inline secrets masked otherwise. */
export function redactText(text: string): string {
	try {
		return JSON.stringify(redactSecrets(JSON.parse(text)));
	} catch {
		return maskInlineSecrets(text);
	}
}

/**
 * The env vars `update_service` writes: the stored map with the agent's
 * changes merged in (a `null` value deletes a var), where a value the agent
 * only ever saw redacted (the whole placeholder, or a URL with its password
 * masked) keeps the stored one. Merging instead of replacing means an agent
 * that sends just the var it changes can't wipe the others.
 *
 * @throws Error when a redacted value doesn't match what's stored, rather
 *   than writing the placeholder into the service.
 */
export function mergeEnvChanges(
	sent: Record<string, unknown>,
	stored: Record<string, string>,
): Record<string, string> {
	const merged = { ...stored };
	for (const [name, value] of Object.entries(sent)) {
		if (value === null) {
			delete merged[name];
			continue;
		}
		const text = String(value);
		if (!text.includes(REDACTED)) {
			merged[name] = text;
			continue;
		}
		const current = stored[name];
		if (current === undefined || redactEnvValue(name, current) !== text) {
			throw new Error(
				`${name} still contains "${REDACTED}": send its real value, or leave it out to keep the stored one.`,
			);
		}
	}
	return merged;
}

/**
 * A command or entrypoint `update_service` writes: an argument the agent sent
 * back redacted keeps the stored one at that position.
 *
 * @throws Error when a redacted argument has no stored one to restore.
 */
export function restoreArgv(
	sent: unknown[],
	stored: string[] | null,
): unknown[] {
	const redactedStored = stored ? redactArgv(stored) : [];
	return sent.map((arg, i) => {
		if (typeof arg !== "string" || !arg.includes(REDACTED)) {
			return arg;
		}
		if (stored && redactedStored[i] === arg) {
			return stored[i];
		}
		throw new Error(
			`Argument ${i + 1} still contains "${REDACTED}": send its real value, or send the command unchanged.`,
		);
	});
}
