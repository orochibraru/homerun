import { parse as parseYaml } from "yaml";
import type {
	ComposeFileDraft,
	ComposeRegistryDraft,
} from "$lib/compose-import";
import { type composeDrafts, isRow, type RawRow, rows, str } from "./common";

/**
 * Reads a Dokploy resource's file mounts (`type: "file"`, the content stored
 * in Dokploy itself) into file drafts, which the import writes onto this host
 * and bind-mounts at the same container path.
 */
export function dokployFileMounts(row: RawRow): ComposeFileDraft[] {
	return rows(row.mounts).flatMap((mount) => {
		const containerPath = str(mount, "mountPath")?.replace(/:(ro|rw)$/, "");
		const content = mount.content;
		return str(mount, "type") === "file" &&
			containerPath &&
			typeof content === "string"
			? [{ containerPath, content }]
			: [];
	});
}

/**
 * Reads the private registry credentials a Dokploy image application pulls
 * with, or null for a public image. Warns when Dokploy returned a username
 * but no password, which then has to be filled in on the Source tab.
 */
export function dokployRegistry(
	row: RawRow,
	warnings: string[],
): ComposeRegistryDraft | null {
	const username = str(row, "username");
	if (!username) {
		return null;
	}
	const password =
		typeof row.password === "string" && row.password ? row.password : null;
	if (!password) {
		warnings.push(
			"Dokploy didn't return the registry password : set it on the Source tab.",
		);
	}
	return { password, url: str(row, "registryUrl"), username };
}

/**
 * The start command a Dokploy resource runs with, as an entrypoint and
 * command pair, mirroring how Dokploy applies it to its swarm service: a
 * `command` string runs through `/bin/sh -c`, and an `args` list replaces the
 * arguments. `fallback` is the shell command Dokploy uses when none is set
 * (the Redis password), if any.
 */
export function dokployStartCommand(
	row: RawRow,
	fallback: string | null = null,
): { command: string[] | null; entrypoint: string[] | null } {
	const shell = str(row, "command") ?? fallback;
	const args = Array.isArray(row.args)
		? row.args.filter((arg): arg is string => typeof arg === "string")
		: [];
	if (args.length > 0) {
		return { command: args, entrypoint: shell ? ["/bin/sh"] : null };
	}
	return shell
		? { command: ["-c", shell], entrypoint: ["/bin/sh"] }
		: { command: null, entrypoint: null };
}

/**
 * The compose services' short-syntax volume entries whose source points into
 * Dokploy's per-stack `files/` directory, keyed by compose service.
 */
function composeFileBinds(
	file: string,
): Array<{ containerPath: string; key: string; source: string }> {
	let doc: unknown;
	try {
		doc = parseYaml(file);
	} catch {
		return [];
	}
	const services = isRow(doc) && isRow(doc.services) ? doc.services : {};
	return Object.entries(services).flatMap(([key, service]) => {
		const volumes =
			isRow(service) && Array.isArray(service.volumes) ? service.volumes : [];
		return volumes.flatMap((entry) => {
			if (typeof entry !== "string") {
				return [];
			}
			const [source = "", containerPath] = entry.split(":");
			return containerPath && /(^|\/)files\//.test(source)
				? [{ containerPath, key, source }]
				: [];
		});
	});
}

/**
 * Carries a Dokploy stack's file mounts over: Dokploy stores each file's
 * content itself and the compose file binds it from `../files/<filePath>`, a
 * relative bind the parser can't use, so each such bind whose file Dokploy
 * returned becomes a file draft on its service and its "relative bind"
 * warning is dropped.
 */
export function attachComposeFileMounts(
	parsed: ReturnType<typeof composeDrafts>,
	file: string,
	row: RawRow,
): void {
	const contents = new Map(
		rows(row.mounts).flatMap((mount) => {
			const filePath = str(mount, "filePath");
			return str(mount, "type") === "file" &&
				filePath &&
				typeof mount.content === "string"
				? [[filePath.replace(/^\.?\/+/, ""), mount.content] as const]
				: [];
		}),
	);
	for (const bind of composeFileBinds(file)) {
		const content = contents.get(bind.source.replace(/^.*?files\//, ""));
		const draft = parsed.drafts.find((candidate) => candidate.key === bind.key);
		if (content === undefined || !draft) {
			continue;
		}
		draft.files.push({ containerPath: bind.containerPath, content });
		parsed.warnings = parsed.warnings.filter(
			(warning) => !warning.includes(`"${bind.source}"`),
		);
		draft.warnings = draft.warnings.filter(
			(warning) => !warning.includes(`"${bind.source}"`),
		);
	}
}

/** Single-quotes a value for a `/bin/sh -c` command line. */
export function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}
