/** A Terraform expression written as is, e.g. a reference or `var.x`. */
export interface HclExpression {
	expression: string;
}

export type HclValue =
	| boolean
	| HclExpression
	| HclValue[]
	| null
	| number
	| string
	| { [key: string]: HclValue };

export interface HclBlock {
	attributes: [string, HclValue][];
	blocks?: HclBlock[];
	labels: string[];
	type: string;
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const INDENT = "  ";

/** A raw expression, rendered without quotes. */
export function expression(source: string): HclExpression {
	return { expression: source };
}

function isExpression(value: HclValue): value is HclExpression {
	return (
		typeof value === "object" &&
		value !== null &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		typeof (value as { expression?: unknown }).expression === "string"
	);
}

/** Escapes what a quoted string or a heredoc would otherwise interpolate: `${` and `%{`. */
function escapeTemplates(text: string): string {
	return text.replaceAll("${", () => "$${").replaceAll("%{", () => "%%{");
}

/** A one-line HCL string literal: quotes, backslashes, control characters and template sequences escaped. */
export function quote(text: string): string {
	let out = "";
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (character === '"' || character === "\\") {
			out += `\\${character}`;
		} else if (character === "\n") {
			out += "\\n";
		} else if (character === "\r") {
			out += "\\r";
		} else if (character === "\t") {
			out += "\\t";
		} else if (code < 0x20 || code === 0x7f) {
			out += `\\u${code.toString(16).padStart(4, "0")}`;
		} else {
			out += character;
		}
	}
	return `"${escapeTemplates(out)}"`;
}

/**
 * A multi-line string as a heredoc whose delimiter the text doesn't
 * contain, wrapped in `chomp()` when the text has no trailing newline so
 * the value stays byte for byte the same.
 */
function heredoc(text: string, indent: string): string {
	let delimiter = "EOT";
	while (text.split("\n").some((line) => line.trim() === delimiter)) {
		delimiter = `${delimiter}_`;
	}
	const body = escapeTemplates(text.endsWith("\n") ? text : `${text}\n`);
	const block = `<<${delimiter}\n${body}${delimiter}`;
	return text.endsWith("\n")
		? block
		: `chomp(${block.replace(/\n$/, "")}\n${indent})`;
}

function key(name: string): string {
	return IDENTIFIER.test(name) ? name : quote(name);
}

function isMultiline(value: HclValue): boolean {
	if (typeof value === "string") {
		return value.includes("\n");
	}
	if (value === null || typeof value !== "object" || isExpression(value)) {
		return false;
	}
	if (Array.isArray(value)) {
		return value.some(
			(item) =>
				typeof item === "object" && item !== null && !isExpression(item),
		);
	}
	return Object.keys(value).length > 0;
}

/** One value at `indent`, nested maps and lists broken over lines. */
export function renderValue(value: HclValue, indent = ""): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "string") {
		return value.includes("\n") ? heredoc(value, indent) : quote(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (isExpression(value)) {
		return value.expression;
	}
	const inner = indent + INDENT;
	if (Array.isArray(value)) {
		if (!isMultiline(value)) {
			return `[${value.map((item) => renderValue(item, inner)).join(", ")}]`;
		}
		const items = value.map((item) => `${inner}${renderValue(item, inner)},`);
		return `[\n${items.join("\n")}\n${indent}]`;
	}
	const entries = Object.entries(value).sort(([a], [b]) =>
		a < b ? -1 : a > b ? 1 : 0,
	);
	if (entries.length === 0) {
		return "{}";
	}
	return `{\n${renderAttributes(
		entries.map(([name, item]) => [key(name), item]),
		inner,
	)}\n${indent}}`;
}

/**
 * Attribute lines at `indent`, with the `=` of consecutive single-line
 * attributes aligned the way `terraform fmt` aligns them.
 */
function renderAttributes(
	attributes: [string, HclValue][],
	indent: string,
): string {
	const lines: string[] = [];
	let group: [string, HclValue][] = [];
	const flush = () => {
		const width = Math.max(0, ...group.map(([name]) => name.length));
		for (const [name, value] of group) {
			lines.push(
				`${indent}${name.padEnd(width)} = ${renderValue(value, indent)}`,
			);
		}
		group = [];
	};
	for (const [name, value] of attributes) {
		if (typeof value === "string" && value.endsWith("\n")) {
			group.push([name, value]);
			flush();
		} else if (isMultiline(value)) {
			flush();
			lines.push(`${indent}${name} = ${renderValue(value, indent)}`);
		} else {
			group.push([name, value]);
		}
	}
	flush();
	return lines.join("\n");
}

function renderBlock(block: HclBlock, indent: string): string {
	const labels = block.labels.map((label) => ` ${quote(label)}`).join("");
	const inner = indent + INDENT;
	const parts = [
		block.attributes.length > 0
			? renderAttributes(block.attributes, inner)
			: "",
		...(block.blocks ?? []).map((child) => renderBlock(child, inner)),
	].filter(Boolean);
	if (parts.length === 0) {
		return `${indent}${block.type}${labels} {}`;
	}
	return `${indent}${block.type}${labels} {\n${parts.join("\n\n")}\n${indent}}`;
}

/** A Terraform file: the blocks in the order given, a blank line between them, ending with a newline. */
export function renderHcl(blocks: HclBlock[]): string {
	return `${blocks.map((block) => renderBlock(block, "")).join("\n\n")}\n`;
}
