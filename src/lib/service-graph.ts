export interface GraphService {
	envVars: Record<string, string> | null;
	id: string;
	slug: string;
}

export interface GraphServiceInfo {
	category: string | null;
	containerId: string | null;
	currentStatus: string;
	desiredState: string;
	icon: string | null;
	id: string;
	image: string;
	name: string;
	slug: string;
	stackId: string | null;
}

/** The slice of a service row a dependency tree or diagram draws. */
export function toGraphService(
	row: Omit<GraphServiceInfo, "image"> & { image: string; tag: string },
): GraphServiceInfo {
	return {
		category: row.category,
		containerId: row.containerId,
		currentStatus: row.currentStatus,
		desiredState: row.desiredState,
		icon: row.icon,
		id: row.id,
		image: `${row.image}:${row.tag}`,
		name: row.name,
		slug: row.slug,
		stackId: row.stackId,
	};
}

export interface PreviewRow {
	branch: string | null;
	currentStatus: string;
	id: string;
	name: string;
	parentId: string;
	prNumber: number;
	title: string | null;
}

/** A pull request preview as it's listed under its parent service. */
export function toPreviewRow(row: {
	currentStatus: string;
	id: string;
	name: string;
	previewBranch: string | null;
	previewParentId: string | null;
	previewPrNumber: number | null;
	previewPrTitle: string | null;
}): PreviewRow {
	return {
		branch: row.previewBranch,
		currentStatus: row.currentStatus,
		id: row.id,
		name: row.name,
		parentId: row.previewParentId ?? "",
		prNumber: row.previewPrNumber ?? 0,
		title: row.previewPrTitle,
	};
}

/** Previews grouped by the service they preview. */
export function previewsByParent(
	previews: PreviewRow[],
): Map<string, PreviewRow[]> {
	const byParent = new Map<string, PreviewRow[]>();
	for (const preview of previews) {
		byParent.set(preview.parentId, [
			...(byParent.get(preview.parentId) ?? []),
			preview,
		]);
	}
	return byParent;
}

export interface DependencyNode {
	children: DependencyNode[];
	id: string;
	/** Already expanded elsewhere in the tree, so it's shown without its children again. */
	repeat: boolean;
}

const URL_HOST_RE = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^:/?#@]+)/i;
const HOST_PORT_RE = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?):\d+(?:\/.*)?$/i;
const BARE_HOST_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i;
const HOST_KEY_RE =
	/(^|_)(HOST|HOSTNAME|URL|URI|ADDR|ADDRESS|SERVER|ENDPOINT|DSN|UPSTREAM|BACKEND|BROKERS?|NODES?)(_|$)/i;

/**
 * The hostnames an env value names: each URL's host (not its user, password
 * or path), each `host:port`, and a bare name only under a host-ish key
 * (`REDIS_HOST`, `WORKER_URL`), since `POSTGRES_DB=stremthru` names a
 * database, not a service. Comma, semicolon and space separated lists are
 * read item by item.
 */
export function hostsIn(value: string, key = ""): string[] {
	return value.split(/[\s,;]+/).flatMap((part) => {
		const host =
			URL_HOST_RE.exec(part)?.[1] ??
			HOST_PORT_RE.exec(part)?.[1] ??
			(HOST_KEY_RE.test(key) && BARE_HOST_RE.test(part) ? part : undefined);
		return host ? [host.toLowerCase()] : [];
	});
}

/**
 * Whether `value` (under env var `key`) points at the host `slug`, as a URL's
 * host, a `host:port` or a bare name under a host-ish key; see `hostsIn`.
 */
export function referencesHost(value: string, slug: string, key = ""): boolean {
	return hostsIn(value, key).includes(slug.toLowerCase());
}

/** The env var names in `envVars` whose value points at the host `slug`: what unlinking from that service removes. */
export function linkKeys(
	envVars: Record<string, string> | null,
	slug: string,
): string[] {
	return Object.entries(envVars ?? {})
		.filter(([key, value]) => referencesHost(value, slug, key))
		.map(([key]) => key);
}

/**
 * Which services each service talks to, read off its env values: an edge
 * from A to B when one of A's env values points at B's slug as a host, which
 * is what a service link writes and what a hand-written URL looks like too.
 */
export function dependencyMap(services: GraphService[]): Map<string, string[]> {
	const deps = new Map<string, string[]>();
	for (const from of services) {
		const entries = Object.entries(from.envVars ?? {});
		deps.set(
			from.id,
			services
				.filter(
					(to) =>
						to.id !== from.id &&
						entries.some(([key, value]) => referencesHost(value, to.slug, key)),
				)
				.map((to) => to.id),
		);
	}
	return deps;
}

/**
 * The members of a stack as dependency trees: the ones no other member
 * depends on at the top, each one's dependencies (members or not) nested
 * under it. A dependency shared by two parents appears under both but is
 * only expanded the first time (`repeat` on the others), a dependency that
 * isn't a member is shown without its own dependencies (its stack's section
 * draws those), and a cycle ends where it would loop. Members only reachable through a cycle still get a
 * tree of their own, so none go missing.
 */
export function dependencyForest(
	memberIds: string[],
	deps: Map<string, string[]>,
): DependencyNode[] {
	const members = new Set(memberIds);
	const dependedOn = new Set(
		memberIds.flatMap((id) =>
			(deps.get(id) ?? []).filter((d) => members.has(d)),
		),
	);
	const expanded = new Set<string>();
	const build = (id: string, path: Set<string>): DependencyNode => {
		if (expanded.has(id) || path.has(id)) {
			return { children: [], id, repeat: true };
		}
		if (!members.has(id)) {
			return { children: [], id, repeat: false };
		}
		expanded.add(id);
		const nextPath = new Set([...path, id]);
		return {
			children: (deps.get(id) ?? []).map((dep) => build(dep, nextPath)),
			id,
			repeat: false,
		};
	};
	const roots = memberIds.filter((id) => !dependedOn.has(id));
	const forest = roots.map((id) => build(id, new Set()));
	for (const id of memberIds) {
		if (!expanded.has(id)) {
			forest.push(build(id, new Set()));
		}
	}
	return forest;
}

/**
 * The rows of a dependency diagram: row 0 holds what nothing else here
 * depends on, and every service sits one row below the lowest of the ones
 * that depend on it, so arrows always point down. Only edges between the
 * given ids count; a cycle can't push a service down forever.
 */
export function dependencyLayers(
	ids: string[],
	deps: Map<string, string[]>,
): string[][] {
	const inSet = new Set(ids);
	const depth = new Map(ids.map((id) => [id, 0]));
	for (let pass = 0; pass < ids.length; pass++) {
		let changed = false;
		for (const id of ids) {
			for (const dep of deps.get(id) ?? []) {
				if (!inSet.has(dep)) {
					continue;
				}
				const wanted = (depth.get(id) ?? 0) + 1;
				if (wanted > (depth.get(dep) ?? 0) && wanted < ids.length) {
					depth.set(dep, wanted);
					changed = true;
				}
			}
		}
		if (!changed) {
			break;
		}
	}
	const layers: string[][] = [];
	for (const id of ids) {
		const row = depth.get(id) ?? 0;
		layers[row] = [...(layers[row] ?? []), id];
	}
	return layers.filter((row) => row.length > 0);
}

/** Every edge of the given dependency maps together, each service's dependencies listed once. */
export function mergeDependencies(
	...maps: Map<string, string[]>[]
): Map<string, string[]> {
	const merged = new Map<string, string[]>();
	for (const map of maps) {
		for (const [id, deps] of map) {
			merged.set(id, [...new Set([...(merged.get(id) ?? []), ...deps])]);
		}
	}
	return merged;
}

/** Whether making `from` depend on `to` would close a loop: `to` is `from`, or already depends on it at any depth. */
export function createsCycle(
	from: string,
	to: string,
	deps: Map<string, string[]>,
): boolean {
	const seen = new Set<string>();
	const stack = [to];
	while (stack.length > 0) {
		const current = stack.pop() as string;
		if (current === from) {
			return true;
		}
		if (!seen.has(current)) {
			seen.add(current);
			stack.push(...(deps.get(current) ?? []));
		}
	}
	return false;
}
