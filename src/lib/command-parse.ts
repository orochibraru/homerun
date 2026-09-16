type Quote = '"' | "'" | null;

interface SplitState {
	argv: string[];
	current: string;
	quote: Quote;
	started: boolean;
}

function parseJsonArgv(trimmed: string): string[] | null {
	if (!trimmed.startsWith("[")) {
		return null;
	}
	try {
		const parsed: unknown = JSON.parse(trimmed);
		return Array.isArray(parsed) ? parsed.map(String) : null;
	} catch {
		return null;
	}
}

function flush(state: SplitState): void {
	if (state.started) {
		state.argv.push(state.current);
		state.current = "";
		state.started = false;
	}
}

function consumeQuoted(state: SplitState, char: string): void {
	if (char === state.quote) {
		state.quote = null;
		return;
	}
	state.current += char;
}

/**
 * Feeds one unescaped character into the shell-style splitter: opens or closes a
 * quote, ends the current argument on unquoted whitespace, and otherwise appends
 * to it.
 */
function consume(state: SplitState, char: string): void {
	if (state.quote) {
		consumeQuoted(state, char);
		return;
	}
	if (char === '"' || char === "'") {
		state.quote = char;
		state.started = true;
		return;
	}
	if (/\s/.test(char)) {
		flush(state);
		return;
	}
	state.current += char;
	state.started = true;
}

/**
 * Parses a user-entered command into an argv array. Accepts either a JSON array
 * (`["sh", "-c", "..."]`) or a shell-like string with single/double quotes and
 * backslash escapes (literal inside single quotes). No variable expansion or
 * globbing is done.
 *
 * @returns An empty array for blank input.
 */
export function parseCommand(input: string): string[] {
	const trimmed = input.trim();
	if (trimmed === "") {
		return [];
	}

	const json = parseJsonArgv(trimmed);
	if (json) {
		return json;
	}

	const state: SplitState = {
		argv: [],
		current: "",
		quote: null,
		started: false,
	};

	for (let i = 0; i < trimmed.length; i += 1) {
		const char = trimmed[i] as string;
		if (char === "\\" && state.quote !== "'" && i + 1 < trimmed.length) {
			state.current += trimmed[i + 1];
			state.started = true;
			i += 1;
			continue;
		}
		consume(state, char);
	}

	flush(state);
	return state.argv;
}
