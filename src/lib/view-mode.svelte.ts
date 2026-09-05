export type EntityViewMode = "card" | "list";

const STORAGE_PREFIX = "homerun:view:";

function readStored(key: string): EntityViewMode | null {
	if (typeof localStorage === "undefined") {
		return null;
	}
	try {
		const stored = localStorage.getItem(key);
		if (stored === "card" || stored === "list") {
			return stored;
		}
		return null;
	} catch {
		return null;
	}
}

function writeStored(key: string, value: EntityViewMode): boolean {
	if (typeof localStorage === "undefined") {
		return false;
	}
	try {
		localStorage.setItem(key, value);
		return true;
	} catch {
		return false;
	}
}

export class ViewMode {
	readonly #storageKey: string;
	#value = $state<EntityViewMode>("list");

	constructor(key: string, fallback: EntityViewMode = "list") {
		this.#storageKey = `${STORAGE_PREFIX}${key}`;
		this.#value = readStored(this.#storageKey) ?? fallback;
	}

	get current(): EntityViewMode {
		return this.#value;
	}

	set current(next: EntityViewMode) {
		this.#value = next;
		writeStored(this.#storageKey, next);
	}
}
