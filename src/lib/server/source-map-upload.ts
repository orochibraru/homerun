import {
	mappedFileName,
	parseSourceMap,
} from "#lib/error-tracking/source-maps.js";
import { sourceMapReleaseParam } from "#lib/server/validation/api.js";

export const MAX_SOURCE_MAP_BYTES = 25 * 1024 * 1024;
export const MAX_SOURCE_MAP_FILES = 500;

export type SourceMapUpload =
	| { error: string; files: null; release: null }
	| {
			error: null;
			files: { content: string; name: string }[];
			release: string;
	  };

/**
 * Reads a source map upload: a `release` field and one file per map, keyed
 * by its path relative to the build output (`_app/immutable/app.js.map`),
 * or by its own file name when the key is `file`. Every file has to be a
 * version 3 source map of at most 25 MiB, and at most 500 come at once.
 */
export async function readSourceMapUpload(
	formData: FormData,
): Promise<SourceMapUpload> {
	const release = sourceMapReleaseParam.safeParse(
		formData.get("release") ?? "",
	);
	if (!release.success) {
		return {
			error: release.error.issues[0]?.message ?? "Invalid release.",
			files: null,
			release: null,
		};
	}
	const entries: [string, File][] = [];
	for (const [key, value] of formData.entries()) {
		const entry: unknown = value;
		if (entry instanceof File) {
			entries.push([key, entry]);
		}
	}
	if (entries.length === 0) {
		return {
			error: "Attach at least one .map file.",
			files: null,
			release: null,
		};
	}
	if (entries.length > MAX_SOURCE_MAP_FILES) {
		return {
			error: `At most ${MAX_SOURCE_MAP_FILES} files per upload.`,
			files: null,
			release: null,
		};
	}
	const files: { content: string; name: string }[] = [];
	for (const [key, file] of entries) {
		const path = key === "file" ? file.name : key;
		if (file.size > MAX_SOURCE_MAP_BYTES) {
			return { error: `${path} is over 25 MiB.`, files: null, release: null };
		}
		// oxlint-disable-next-line no-await-in-loop -- files are read one at a time to keep memory flat
		const content = await file.text();
		try {
			parseSourceMap(content);
		} catch {
			return {
				error: `${path} isn't a version 3 source map.`,
				files: null,
				release: null,
			};
		}
		files.push({ content, name: mappedFileName(path) });
	}
	return { error: null, files, release: release.data };
}
