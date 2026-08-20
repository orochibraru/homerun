/**
 * Minimal ANSI SGR (Select Graphic Rendition) parser for container log
 * lines : Docker doesn't strip color codes from a container's stdout, so a
 * raw log line often contains escape sequences like `\x1b[32mOK\x1b[0m`.
 * Rather than rendering that literally (garbled control characters) or
 * stripping it (losing the color the app itself chose), this splits one
 * line into styled segments the UI renders as `<span>`s : no `{@html}`
 * anywhere, so there's no injection surface even though the source is a
 * live container's own output.
 *
 * Covers the common subset actually seen in practice: reset, bold, dim,
 * italic, underline, the 8 standard + 8 bright foreground/background
 * colors, and default-color resets (39/49). 256-color and truecolor SGR
 * sequences (38;5;n / 38;2;r;g;b) are recognized and skipped over (their
 * text still renders, just without that color) rather than leaking into
 * the visible text : better an uncolored line than a `[38;5;208m` you
 * have to read past.
 */

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching the literal ESC control char is the whole point of an ANSI parser
const ANSI_SGR_RE = /\x1b\[([0-9;]*)m/g;

const FG_COLOR_CLASS: Record<number, string> = {
	30: "text-zinc-900",
	31: "text-red-400",
	32: "text-green-400",
	33: "text-yellow-400",
	34: "text-blue-400",
	35: "text-fuchsia-400",
	36: "text-cyan-400",
	37: "text-zinc-300",
	90: "text-zinc-500",
	91: "text-red-300",
	92: "text-green-300",
	93: "text-yellow-300",
	94: "text-blue-300",
	95: "text-fuchsia-300",
	96: "text-cyan-300",
	97: "text-white",
};

const BG_COLOR_CLASS: Record<number, string> = {
	40: "bg-zinc-900",
	41: "bg-red-900",
	42: "bg-green-900",
	43: "bg-yellow-900",
	44: "bg-blue-900",
	45: "bg-fuchsia-900",
	46: "bg-cyan-900",
	47: "bg-zinc-300",
	100: "bg-zinc-700",
	101: "bg-red-700",
	102: "bg-green-700",
	103: "bg-yellow-700",
	104: "bg-blue-700",
	105: "bg-fuchsia-700",
	106: "bg-cyan-700",
	107: "bg-zinc-100",
};

export interface AnsiSegment {
	className: string;
	text: string;
}

interface SgrState {
	bg?: string;
	bold: boolean;
	dim: boolean;
	fg?: string;
	italic: boolean;
	underline: boolean;
}

function applyCodes(state: SgrState, codes: number[]): void {
	let i = 0;
	while (i < codes.length) {
		const code = codes[i];
		if (code === 0) {
			state.bold = false;
			state.dim = false;
			state.italic = false;
			state.underline = false;
			state.fg = undefined;
			state.bg = undefined;
		} else if (code === 1) {
			state.bold = true;
		} else if (code === 2) {
			state.dim = true;
		} else if (code === 3) {
			state.italic = true;
		} else if (code === 4) {
			state.underline = true;
		} else if (code === 22) {
			state.bold = false;
			state.dim = false;
		} else if (code === 23) {
			state.italic = false;
		} else if (code === 24) {
			state.underline = false;
		} else if (code === 39) {
			state.fg = undefined;
		} else if (code === 49) {
			state.bg = undefined;
		} else if (code === 38 || code === 48) {
			// Extended color (256-color or truecolor) : consume its trailing
			// params so they don't get misread as separate SGR codes, but
			// don't attempt to render the actual color (see module docstring).
			const mode = codes[i + 1];
			if (mode === 5) {
				i += 2; // 38;5;n
			} else if (mode === 2) {
				i += 4; // 38;2;r;g;b
			}
		} else if (code in FG_COLOR_CLASS) {
			state.fg = FG_COLOR_CLASS[code];
		} else if (code in BG_COLOR_CLASS) {
			state.bg = BG_COLOR_CLASS[code];
		}
		i += 1;
	}
}

function classForState(state: SgrState): string {
	const classes: string[] = [];
	if (state.fg) {
		classes.push(state.fg);
	}
	if (state.bg) {
		classes.push(state.bg);
	}
	if (state.bold) {
		classes.push("font-bold");
	}
	if (state.dim) {
		classes.push("opacity-60");
	}
	if (state.italic) {
		classes.push("italic");
	}
	if (state.underline) {
		classes.push("underline");
	}
	return classes.join(" ");
}

/** Splits one log line into styled segments, stripping the ANSI escape codes themselves out of the visible text. */
export function parseAnsiLine(line: string): AnsiSegment[] {
	if (!line.includes("\x1b[")) {
		return [{ className: "", text: line }];
	}

	const segments: AnsiSegment[] = [];
	const state: SgrState = {
		bold: false,
		dim: false,
		italic: false,
		underline: false,
	};
	let lastIndex = 0;

	ANSI_SGR_RE.lastIndex = 0;
	let match: RegExpExecArray | null = ANSI_SGR_RE.exec(line);
	while (match) {
		const text = line.slice(lastIndex, match.index);
		if (text) {
			segments.push({ className: classForState(state), text });
		}
		const codes = match[1].length > 0 ? match[1].split(";").map(Number) : [0];
		applyCodes(state, codes);
		lastIndex = ANSI_SGR_RE.lastIndex;
		match = ANSI_SGR_RE.exec(line);
	}

	const rest = line.slice(lastIndex);
	if (rest) {
		segments.push({ className: classForState(state), text: rest });
	}

	return segments.length > 0 ? segments : [{ className: "", text: "" }];
}
