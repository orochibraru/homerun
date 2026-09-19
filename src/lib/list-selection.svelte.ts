export class ListSelection {
	readonly #visibleIds: () => string[];
	ids = $state<string[]>([]);
	readonly #selected = $derived(new Set(this.ids));

	/**
	 * Tracks which rows of a paginated list are selected. Must be constructed
	 * during component init: it registers an effect that drops any selected id
	 * no longer visible (paging, searching or filtering reloads the rows), so
	 * the bulk bar never submits rows the user can't see.
	 *
	 * @param visibleIds The ids of the rows currently on screen.
	 */
	constructor(visibleIds: () => string[]) {
		this.#visibleIds = visibleIds;
		$effect(() => {
			const visible = new Set(this.#visibleIds());
			if (this.ids.some((id) => !visible.has(id))) {
				this.ids = this.ids.filter((id) => visible.has(id));
			}
		});
	}

	/** How many rows are selected. */
	get count(): number {
		return this.ids.length;
	}

	/** Whether every visible row is selected (false for an empty list). */
	get allVisible(): boolean {
		const visible = this.#visibleIds();
		return visible.length > 0 && visible.every((id) => this.#selected.has(id));
	}

	/** Whether `id` is selected. */
	has(id: string): boolean {
		return this.#selected.has(id);
	}

	/** Selects `id`, or unselects it if it already was. */
	toggle(id: string): void {
		this.ids = this.#selected.has(id)
			? this.ids.filter((other) => other !== id)
			: [...this.ids, id];
	}

	/** Selects every visible row, or clears the selection if they all already were. */
	toggleAllVisible(): void {
		this.ids = this.allVisible ? [] : [...this.#visibleIds()];
	}

	/** Unselects everything. */
	clear(): void {
		this.ids = [];
	}
}
