export interface GraphService {
	envVars: Record<string, string> | null;
	id: string;
	slug: string;
}

export interface DependencyNode {
	children: DependencyNode[];
	id: string;
	/** Already expanded elsewhere in the tree, so it's shown without its children again. */
	repeat: boolean;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Whether `value` points at the host `slug`: the slug standing alone as a
 * hostname (`vortex-redis:6379`, `redis://:pw@vortex-redis/0`,
 * `http://vortex-server`), not as part of a longer name (`redis` inside
 * `vortex-redis` or `redis.io`) nor as a URL's scheme (`redis://`).
 */
export function referencesHost(value: string, slug: string): boolean {
	return new RegExp(
		`(?:^|[^a-z0-9.-])${escapeRegExp(slug)}(?!://)(?:[^a-z0-9.-]|$)`,
		"i",
	).test(value);
}

/**
 * Which services each service talks to, read off its env values: an edge
 * from A to B when one of A's env values points at B's slug as a host, which
 * is what a service link writes and what a hand-written URL looks like too.
 */
export function dependencyMap(services: GraphService[]): Map<string, string[]> {
	const deps = new Map<string, string[]>();
	for (const from of services) {
		const values = Object.values(from.envVars ?? {});
		deps.set(
			from.id,
			services
				.filter(
					(to) =>
						to.id !== from.id &&
						values.some((value) => referencesHost(value, to.slug)),
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
