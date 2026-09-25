import type { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import {
	contentChunks,
	isEditableText,
	MAX_EDITABLE_BYTES,
	parseListing,
	type VolumeEntry,
} from "$lib/volume-files";
import {
	VOLUME_HELPER_IMAGE,
	VOLUME_HELPER_TAG,
} from "./backup/volume-services.ts";
import { DockerService } from "./docker.service.ts";

const MOUNT = "/vol/t";
const TARGET = `T="${MOUNT}\${P:+/$P}"`;
const STAT = `stat -c '%F|%s|%Y|%n'`;
const TIMEOUT_MS = 30_000;

export const LIST_SCRIPT = `${TARGET}; if [ -f "$T" ]; then ${STAT} "$T"; exit 0; fi; cd "$T" 2>/dev/null || exit 3; for f in .[!.]* ..?* *; do if [ -e "$f" ] || [ -L "$f" ]; then ${STAT} "$f"; fi; done`;
export const READ_SCRIPT = `${TARGET}; [ -f "$T" ] || exit 3; [ "$(stat -c %s "$T")" -le ${MAX_EDITABLE_BYTES} ] || exit 4; cat "$T"`;
export const WRITE_SCRIPT = `${TARGET}; [ -d "$T" ] && exit 5; i=0; while [ "$i" -lt "$N" ]; do eval "printf '%s' \\"\\$C$i\\""; i=$((i+1)); done | base64 -d > /tmp/homerun-new || exit 6; cat /tmp/homerun-new > "$T" || exit 7`;

const FAILURES: Record<number, string> = {
	3: "That path doesn't exist in the volume.",
	4: `The file is over ${MAX_EDITABLE_BYTES / 1024 / 1024} MB : too big to edit here.`,
	5: "That path is a directory.",
	6: "Couldn't decode the new content.",
	7: "Couldn't write the file : check the volume isn't read-only.",
};

export interface VolumeListing {
	entries: (VolumeEntry & { path: string })[];
	isFile: boolean;
}

export type VolumeFile =
	| { editable: true; content: string; size: number }
	| { editable: false; size: number };

/** One volume's files, read and written through a short-lived helper container that mounts it. */
class VolumeFilesServiceClass {
	/**
	 * Runs `script` in the helper with the volume mounted and `env` set.
	 *
	 * @throws Error with a readable reason when the helper exits non-zero or
	 *   times out.
	 */
	async #run(
		volume: StorageVolumeDTO,
		script: string,
		env: Record<string, string>,
		writable: boolean,
	): Promise<Buffer> {
		const result = await DockerService.runOneOff({
			binds: [`${volume.source}:${MOUNT}${writable ? "" : ":ro"}`],
			cmd: ["sh", "-c", script],
			envVars: env,
			image: VOLUME_HELPER_IMAGE,
			tag: VOLUME_HELPER_TAG,
			timeoutMs: TIMEOUT_MS,
		});
		if (result.timedOut) {
			throw new Error("The helper container timed out.");
		}
		if (result.exitCode !== 0) {
			throw new Error(
				FAILURES[result.exitCode] ??
					(result.stderr.toString("utf8").trim() ||
						`The helper container exited with code ${result.exitCode}.`),
			);
		}
		return result.stdout;
	}

	/**
	 * The entries at `path` inside the volume, directories first, each with
	 * the path to open it. A volume that is a single bound file lists that one
	 * file under its own name, at path "".
	 *
	 * @throws Error when the path doesn't exist or the helper fails.
	 */
	async list(volume: StorageVolumeDTO, path: string): Promise<VolumeListing> {
		const output = await this.#run(volume, LIST_SCRIPT, { P: path }, false);
		const entries = parseListing(output.toString("utf8"));
		const single = entries.length === 1 && entries[0]?.name === "t";
		if (path === "" && single && entries[0]?.kind === "file") {
			const name = volume.source.split("/").pop() || volume.name;
			return { entries: [{ ...entries[0], name, path: "" }], isFile: true };
		}
		return {
			entries: entries.map((entry) => ({
				...entry,
				path: path ? `${path}/${entry.name}` : entry.name,
			})),
			isFile: false,
		};
	}

	/**
	 * A file's content when it's text under the editing limit, otherwise just
	 * its size.
	 *
	 * @throws Error when it isn't a file, is too big, or the helper fails.
	 */
	async read(volume: StorageVolumeDTO, path: string): Promise<VolumeFile> {
		const bytes = await this.#run(volume, READ_SCRIPT, { P: path }, false);
		return isEditableText(bytes)
			? { content: bytes.toString("utf8"), editable: true, size: bytes.length }
			: { editable: false, size: bytes.length };
	}

	/**
	 * Replaces a file's content in place, keeping its owner and mode, or
	 * creates it inside an existing directory.
	 *
	 * @throws Error when the path is a directory or the write fails.
	 */
	async write(
		volume: StorageVolumeDTO,
		path: string,
		content: string,
	): Promise<void> {
		const chunks = contentChunks(content);
		await this.#run(
			volume,
			WRITE_SCRIPT,
			{ ...chunks, N: String(Object.keys(chunks).length), P: path },
			true,
		);
	}
}

export const VolumeFilesService = new VolumeFilesServiceClass();
