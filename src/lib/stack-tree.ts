export interface StackNode {
	id: string;
	name: string;
	parentId: string | null;
	slug: string;
}

/** The ids of every ancestor of `id`, nearest first, stopping at a loop rather than spinning on one. */
export function ancestorIds(
	id: string,
	parents: Map<string, string | null>,
): string[] {
	const chain: string[] = [];
	let current = parents.get(id) ?? null;
	while (current && !chain.includes(current) && current !== id) {
		chain.push(current);
		current = parents.get(current) ?? null;
	}
	return chain;
}

/** Whether nesting `stackId` under `parentId` would make a stack its own ancestor. */
export function wouldCycle(
	stackId: string,
	parentId: string,
	parents: Map<string, string | null>,
): boolean {
	return (
		parentId === stackId || ancestorIds(parentId, parents).includes(stackId)
	);
}

/** The ids of every stack nested under `id`, at any depth. */
export function descendantIds(id: string, stacks: StackNode[]): string[] {
	const found: string[] = [];
	const queue = [id];
	while (queue.length > 0) {
		const current = queue.shift();
		for (const child of stacks) {
			if (child.parentId === current && !found.includes(child.id)) {
				found.push(child.id);
				queue.push(child.id);
			}
		}
	}
	return found;
}

/** A stack's display path from the top, `Media / Vortex`. */
export function stackPath(id: string, stacks: StackNode[]): string {
	const byId = new Map(stacks.map((s) => [s.id, s]));
	const parents = new Map(stacks.map((s) => [s.id, s.parentId]));
	return [...ancestorIds(id, parents).reverse(), id]
		.map((stackId) => byId.get(stackId)?.name ?? "?")
		.join(" / ");
}

/**
 * Stacks in tree order, each with its depth, for an indented list: a parent
 * right before its children, siblings by name. A stack whose parent is
 * missing counts as top-level.
 */
export function flattenStackTree<T extends StackNode>(
	stacks: T[],
): Array<{ depth: number; stack: T }> {
	const ids = new Set(stacks.map((s) => s.id));
	const byParent = new Map<string | null, T[]>();
	for (const s of stacks) {
		const parent = s.parentId && ids.has(s.parentId) ? s.parentId : null;
		byParent.set(parent, [...(byParent.get(parent) ?? []), s]);
	}
	const out: Array<{ depth: number; stack: T }> = [];
	const walk = (parent: string | null, depth: number, seen: Set<string>) => {
		const children = [...(byParent.get(parent) ?? [])].sort((a, b) =>
			a.name.localeCompare(b.name),
		);
		for (const child of children) {
			if (seen.has(child.id)) {
				continue;
			}
			out.push({ depth, stack: child });
			walk(child.id, depth + 1, new Set([...seen, child.id]));
		}
	};
	walk(null, 0, new Set());
	return out;
}
