interface SplitState {
	current: string;
	inWord: boolean;
	quote: "'" | '"' | null;
	words: string[];
}

/** Consumes one character inside quotes, returning how many extra characters it used (1 for a backslash escape inside double quotes). */
function consumeQuoted(state: SplitState, text: string, index: number): number {
	const char = text[index] as string;
	if (char === state.quote) {
		state.quote = null;
		return 0;
	}
	if (state.quote === '"' && char === "\\" && index + 1 < text.length) {
		state.current += text[index + 1];
		return 1;
	}
	state.current += char;
	return 0;
}

/** Consumes one character outside quotes, returning how many extra characters it used (1 for a backslash escape). */
function consumeBare(state: SplitState, text: string, index: number): number {
	const char = text[index] as string;
	if (/\s/.test(char)) {
		if (state.inWord) {
			state.words.push(state.current);
			state.current = "";
			state.inWord = false;
		}
		return 0;
	}
	state.inWord = true;
	if (char === "'" || char === '"') {
		state.quote = char;
		return 0;
	}
	if (char === "\\" && index + 1 < text.length) {
		state.current += text[index + 1];
		return 1;
	}
	state.current += char;
	return 0;
}

/**
 * Splits a command line into argv words the way a POSIX shell (and compose's
 * own string form of `command:`/`entrypoint:`) does: whitespace separates
 * words, single quotes keep everything literally, double quotes keep spaces
 * but honour backslash escapes, and a bare backslash escapes the next
 * character. An unterminated quote runs to the end of the text.
 */
export function splitShellWords(text: string): string[] {
	const state: SplitState = {
		current: "",
		inWord: false,
		quote: null,
		words: [],
	};
	for (let index = 0; index < text.length; index += 1) {
		index += state.quote
			? consumeQuoted(state, text, index)
			: consumeBare(state, text, index);
	}
	if (state.inWord) {
		state.words.push(state.current);
	}
	return state.words;
}

/**
 * Joins argv words back into one editable command line, single-quoting any
 * word that `splitShellWords` wouldn't read back unchanged (whitespace,
 * quotes, backslashes, shell metacharacters, or an empty word).
 */
export function joinShellWords(words: string[]): string {
	return words
		.map((word) => {
			if (word !== "" && /^[\w@%+=:,./-]+$/.test(word)) {
				return word;
			}
			return `'${word.replaceAll("'", `'"'"'`)}'`;
		})
		.join(" ");
}

/**
 * Reads a compose-style argv value (a string split with `splitShellWords`, or
 * a list) into words, or null when it's missing or empty.
 */
export function argvFrom(raw: unknown): string[] | null {
	const words = Array.isArray(raw)
		? raw.map(String)
		: typeof raw === "string"
			? splitShellWords(raw)
			: [];
	return words.length > 0 ? words : null;
}
