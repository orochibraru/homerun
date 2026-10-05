export const IAC_API_PREFIX = "/api/v1/iac/";

export interface StateSummary {
	lineage: string | null;
	resources: Map<string, string>;
	serial: number;
}

export interface StateDiff {
	added: string[];
	changed: string[];
	removed: string[];
}

interface RawInstance {
	attributes?: unknown;
	index_key?: number | string;
}

interface RawResource {
	instances?: RawInstance[];
	mode?: string;
	module?: string;
	name?: string;
	type?: string;
}

/** JSON with object keys sorted at every depth, so equal values serialise equally. */
function stableJson(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stableJson).join(",")}]`;
	}
	if (value && typeof value === "object") {
		const entries = Object.entries(value as Record<string, unknown>)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
			.map(([key, inner]) => `${JSON.stringify(key)}:${stableJson(inner)}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/** A resource instance's address the way Terraform prints it, e.g. `module.db.aws_instance.web[0]`. */
export function instanceAddress(
	resource: RawResource,
	instance: RawInstance,
): string {
	const module = resource.module ? `${resource.module}.` : "";
	const data = resource.mode === "data" ? "data." : "";
	const index =
		instance.index_key === undefined
			? ""
			: `[${JSON.stringify(instance.index_key)}]`;
	return `${module}${data}${resource.type ?? "?"}.${resource.name ?? "?"}${index}`;
}

/**
 * The serial, lineage and every resource instance (address to attributes) of
 * a Terraform state body.
 *
 * @throws When the body isn't a JSON object or has no numeric serial.
 */
export function summarizeState(body: string): StateSummary {
	const parsed: unknown = JSON.parse(body);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("The state isn't a JSON object.");
	}
	const state = parsed as {
		lineage?: unknown;
		resources?: RawResource[];
		serial?: unknown;
	};
	if (typeof state.serial !== "number" || !Number.isInteger(state.serial)) {
		throw new Error("The state has no serial.");
	}
	const resources = new Map<string, string>();
	for (const resource of state.resources ?? []) {
		for (const instance of resource.instances ?? []) {
			resources.set(
				instanceAddress(resource, instance),
				stableJson(instance.attributes ?? null),
			);
		}
	}
	return {
		lineage: typeof state.lineage === "string" ? state.lineage : null,
		resources,
		serial: state.serial,
	};
}

/** Which resource instances `after` adds, removes or changes compared with `before`. */
export function diffStates(
	before: StateSummary | null,
	after: StateSummary,
): StateDiff {
	const previous = before?.resources ?? new Map<string, string>();
	const added: string[] = [];
	const changed: string[] = [];
	for (const [address, attributes] of after.resources) {
		const old = previous.get(address);
		if (old === undefined) {
			added.push(address);
		} else if (old !== attributes) {
			changed.push(address);
		}
	}
	const removed = [...previous.keys()].filter(
		(address) => !after.resources.has(address),
	);
	return {
		added: added.sort(),
		changed: changed.sort(),
		removed: removed.sort(),
	};
}

/**
 * The state body with its serial replaced, for a rollback written as a new
 * version on top of the latest one.
 *
 * @throws When the body isn't a JSON object.
 */
export function withSerial(body: string, serial: number): string {
	const parsed: unknown = JSON.parse(body);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("The state isn't a JSON object.");
	}
	return JSON.stringify({ ...(parsed as object), serial }, null, 2);
}

/**
 * The password half of an HTTP Basic `Authorization` header, which is where
 * Terraform's http backend puts its credentials, or null when the header
 * isn't Basic or doesn't decode.
 */
export function basicAuthPassword(header: string | null): string | null {
	const match = header?.match(/^Basic\s+(\S+)$/i);
	if (!match) {
		return null;
	}
	let decoded: string;
	try {
		decoded = atob(match[1]);
	} catch {
		return null;
	}
	const separator = decoded.indexOf(":");
	return separator === -1 ? null : decoded.slice(separator + 1) || null;
}

/** Where a state version's body lives in its project's bucket. */
export function stateObjectKey(input: {
	id: string;
	prefix: string;
	serial: number;
	slug: string;
}): string {
	const prefix = input.prefix.replace(/^\/+|\/+$/g, "");
	return `${prefix ? `${prefix}/` : ""}${input.slug}/${input.serial}-${input.id}.tfstate`;
}

/**
 * Terraform's lock info from a lock or unlock request body, or null when the
 * body isn't a JSON object.
 */
export function parseLockInfo(value: unknown): Record<string, unknown> | null {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}
