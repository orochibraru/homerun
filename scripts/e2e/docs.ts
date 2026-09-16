import { readFileSync } from "node:fs";

export interface FencedBlock {
	heading: string;
	code: string;
	lang: string;
}

class DocsClass {
	readonly #cache = new Map<string, string>();

	/** Reads a file relative to the working directory, caching its content for the rest of the run. */
	#read(relPath: string): string {
		const cached = this.#cache.get(relPath);
		if (cached !== undefined) {
			return cached;
		}
		const content = readFileSync(relPath, "utf8");
		this.#cache.set(relPath, content);
		return content;
	}

	/** Extracts every fenced code block from a Markdown file, tagged with its language and the nearest heading above it. */
	blocks(relPath: string): FencedBlock[] {
		const found: FencedBlock[] = [];
		let heading = "";
		let open: { heading: string; lang: string; lines: string[] } | null = null;
		for (const line of this.#read(relPath).split("\n")) {
			const fence = line.match(/^```(\S*)\s*$/);
			if (open) {
				if (fence) {
					found.push({
						code: open.lines.join("\n"),
						heading: open.heading,
						lang: open.lang,
					});
					open = null;
				} else {
					open.lines.push(line);
				}
				continue;
			}
			if (fence) {
				open = { heading, lang: fence[1] ?? "", lines: [] };
				continue;
			}
			if (line.startsWith("#")) {
				heading = line.replace(/^#+\s*/, "").trim();
			}
		}
		return found;
	}

	/**
	 * Returns the trimmed code of the single fenced block that contains every
	 * needle, so a test runs exactly the command the docs show.
	 *
	 * @throws When no block or more than one block matches.
	 */
	command(relPath: string, ...needles: string[]): string {
		const matches = this.blocks(relPath).filter((block) =>
			needles.every((needle) => block.code.includes(needle)),
		);
		if (matches.length === 0) {
			throw new Error(
				`No code block in ${relPath} contains all of: ${needles.join(", ")}`,
			);
		}
		if (matches.length > 1) {
			throw new Error(
				`${matches.length} code blocks in ${relPath} contain all of: ${needles.join(", ")} (sections: ${matches.map((m) => m.heading).join(" / ")})`,
			);
		}
		return (matches[0] as FencedBlock).code.trim();
	}
}

export const Docs = new DocsClass();

/** Joins backslash-continued lines and collapses whitespace, so a documented command compares equal however it's wrapped. */
export function normalizeCommand(command: string): string {
	return command
		.replace(/\\\s*\n/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/** Splits a shell block into its non-empty lines, trimmed, dropping `#` comment lines. */
export function commandLines(block: string): string[] {
	return block
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0 && !line.startsWith("#"));
}
