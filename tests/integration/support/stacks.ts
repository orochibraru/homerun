import { nativeFetch } from "./config";

export async function deleteStack(
	origin: string,
	apiKey: string,
	stackId: string,
): Promise<void> {
	const res = await nativeFetch(`${origin}/stacks/${stackId}?/delete`, {
		// SvelteKit's form-action dispatch requires form-encoded data on every
		// POST regardless of whether the action itself reads it (this one
		// doesn't) : a bodyless request 415s with "Form actions expect
		// form-encoded data — received null", real finding from actually
		// running this. An empty body still satisfies it.
		body: new URLSearchParams(),
		headers: {
			accept: "application/json",
			"content-type": "application/x-www-form-urlencoded",
			origin,
			"x-api-key": apiKey,
		},
		method: "POST",
	});
	if (!res.ok) {
		throw new Error(
			`stacks/${stackId}?/delete failed: ${res.status} ${await res.text()}`,
		);
	}
}

/** Mirrors ServiceCleanup's shape (support/cleanup.ts) for the one other resource type this suite creates that leaves a real Docker artifact behind. */
export class StackCleanup {
	readonly #origin: string;
	readonly #apiKey: string;
	readonly #ids = new Set<string>();

	constructor(origin: string, apiKey: string) {
		this.#origin = origin;
		this.#apiKey = apiKey;
	}

	track(stackId: string): string {
		this.#ids.add(stackId);
		return stackId;
	}

	async cleanupAll(): Promise<void> {
		const ids = [...this.#ids];
		this.#ids.clear();
		await Promise.all(
			ids.map(async (id) => {
				await deleteStack(this.#origin, this.#apiKey, id).catch(() => {
					// Best-effort : a test that already deleted its own stack, or
					// failed before creating one, shouldn't fail cleanup too.
				});
			}),
		);
	}
}
