import {
	bindVolumeName,
	type ComposeFileDraft,
	type ComposeServiceDraft,
	type ComposeVolumeDraft,
} from "$lib/compose-import";
import { splitShellWords } from "$lib/shell-words";
import { isRow, type RawRow, rows, str } from "./common";

export interface CoolifyStorage {
	files: ComposeFileDraft[];
	volumes: ComposeVolumeDraft[];
}

const STORAGE_KEYS = {
	files: ["file_storages", "fileStorages"],
	persistent: ["persistent_storages", "persistentStorages"],
};

/** A bind mount draft of a host path at a container path. */
function bindDraft(
	slug: string,
	containerPath: string,
	source: string,
): ComposeVolumeDraft {
	return {
		containerPath,
		kind: "bind",
		name: bindVolumeName(slug, containerPath),
		readOnly: false,
		source,
	};
}

/** A Coolify persistent volume row as a volume draft: a bind when it has a `host_path`, a named volume otherwise, null when it names neither. */
function persistentVolume(
	row: RawRow,
	slug: string,
): ComposeVolumeDraft | null {
	const containerPath = str(row, "mount_path");
	const hostPath = str(row, "host_path");
	const name = str(row, "name");
	if (!containerPath) {
		return null;
	}
	if (hostPath) {
		return bindDraft(slug, containerPath, hostPath);
	}
	return name
		? { containerPath, kind: "volume", name, readOnly: false, source: name }
		: null;
}

/** Adds one Coolify file storage row to `storage`: a directory binds its `fs_path`, a file with `content` becomes a file draft. */
function addFileStorage(
	storage: CoolifyStorage,
	row: RawRow,
	slug: string,
): void {
	const containerPath = str(row, "mount_path");
	const fsPath = str(row, "fs_path");
	if (!containerPath) {
		return;
	}
	if (row.is_directory === true && fsPath) {
		storage.volumes.push(bindDraft(slug, containerPath, fsPath));
	} else if (typeof row.content === "string") {
		storage.files.push({ containerPath, content: row.content });
	}
}

/**
 * Reads a Coolify resource's persistent storage, from its `/storages`
 * answer or the detail row itself, whichever carries it: a persistent volume
 * (`name`, `mount_path`, optional `host_path`) becomes a named volume or a
 * bind, a file storage with `content` becomes a file draft, and a directory
 * storage becomes a bind of its `fs_path`. Returns null when nothing looks
 * like storage at all, which means the source didn't say.
 */
export function coolifyStorages(
	body: unknown,
	slug: string,
): CoolifyStorage | null {
	const container = isRow(body) ? body : {};
	const listed = [...STORAGE_KEYS.files, ...STORAGE_KEYS.persistent].some(
		(key) => Array.isArray(container[key]),
	);
	if (!(Array.isArray(body) || listed)) {
		return null;
	}
	const flat = rows(body);
	const persistent = [
		...STORAGE_KEYS.persistent.flatMap((key) => rows(container[key])),
		...flat.filter((row) => !str(row, "fs_path")),
	];
	const files = [
		...STORAGE_KEYS.files.flatMap((key) => rows(container[key])),
		...flat.filter((row) => str(row, "fs_path")),
	];
	const storage: CoolifyStorage = {
		files: [],
		volumes: persistent
			.map((row) => persistentVolume(row, slug))
			.filter((volume): volume is ComposeVolumeDraft => volume !== null),
	};
	for (const row of files) {
		addFileStorage(storage, row, slug);
	}
	return storage;
}

export interface DockerRunOptions {
	capAdd: string[];
	devices: string[];
	entrypoint: string[] | null;
	labels: Record<string, string>;
	privileged: boolean;
	unsupported: string[];
}

type RunFlagHandler = (options: DockerRunOptions, value: string) => void;

const RUN_FLAGS: Record<string, RunFlagHandler> = {
	"--cap-add": (options, value) => {
		options.capAdd.push(value.toUpperCase());
	},
	"--device": (options, value) => {
		options.devices.push(value);
	},
	"--entrypoint": (options, value) => {
		options.entrypoint = value ? splitShellWords(value) : null;
	},
	"--label": (options, value) => {
		const eq = value.indexOf("=");
		options.labels[eq > 0 ? value.slice(0, eq) : value] =
			eq > 0 ? value.slice(eq + 1) : "";
	},
};
RUN_FLAGS["-l"] = RUN_FLAGS["--label"] as RunFlagHandler;

/** Splits a `--flag=value` word into its flag and inline value; any other word comes back with no inline value. */
function splitFlag(word: string): [string, string | undefined] {
	const eq = word.startsWith("-") ? word.indexOf("=") : -1;
	return eq > 0 ? [word.slice(0, eq), word.slice(eq + 1)] : [word, undefined];
}

/**
 * Reads Coolify's `custom_docker_run_options` (`docker run` flags as one
 * string) into the options Homerun can apply: `--cap-add`, `--device`,
 * `--privileged`, `--label`/`-l` and `--entrypoint`, in both `--flag value`
 * and `--flag=value` forms. Every other flag is listed under `unsupported`.
 */
export function parseDockerRunOptions(text: string | null): DockerRunOptions {
	const options: DockerRunOptions = {
		capAdd: [],
		devices: [],
		entrypoint: null,
		labels: {},
		privileged: false,
		unsupported: [],
	};
	const words = splitShellWords(text ?? "");
	while (words.length > 0) {
		const [flag, inline] = splitFlag(words.shift() as string);
		const handler = RUN_FLAGS[flag];
		if (flag === "--privileged") {
			options.privileged = inline !== "false";
		} else if (handler) {
			handler(options, inline ?? words.shift() ?? "");
		} else if (flag.startsWith("-")) {
			options.unsupported.push(flag);
		}
	}
	return options;
}

/**
 * Applies what a Coolify application carries beyond its build to its single
 * draft: the parsed `custom_docker_run_options`, `start_command` as the
 * container command, and its persistent storage when the source listed it.
 * Pushes a warning for run flags that don't carry over, and for storage the
 * source didn't list.
 */
export function applyCoolifyExtras(
	draft: ComposeServiceDraft,
	row: RawRow,
	storage: CoolifyStorage | null,
	warnings: string[],
): void {
	const { unsupported, ...run } = parseDockerRunOptions(
		str(row, "custom_docker_run_options"),
	);
	Object.assign(draft, run);
	if (unsupported.length > 0) {
		warnings.push(
			`Coolify run options ${[...new Set(unsupported)].join(", ")} aren't applied here.`,
		);
	}
	const start = str(row, "start_command");
	if (start) {
		draft.command = ["sh", "-c", start];
	}
	if (!storage) {
		warnings.push(
			"Coolify didn't list this resource's persistent storage : re-attach volumes on the Volumes tab.",
		);
		return;
	}
	draft.volumes = storage.volumes;
	draft.files = storage.files;
}
