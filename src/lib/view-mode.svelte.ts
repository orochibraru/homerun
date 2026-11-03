import { page } from "$app/state";
import { toast } from "svelte-sonner";

import { setViewMode } from "#lib/remote/view-mode.remote.js";
import { toastError } from "#lib/toast.js";
import { type EntityViewMode, storedViewMode } from "#lib/view-modes.js";

export type { EntityViewMode } from "#lib/view-modes.js";

const LABELS: Record<EntityViewMode, string> = {
	card: "Card view",
	list: "List view",
};

/**
 * One list page's list/card choice, kept in the account's preferences
 * (`user_preferences.view_modes`), which the protected layout loads before
 * the page renders, so the server draws the stored mode from the first byte.
 * One instance can drive several `EntityList`s that share a toggle.
 */
export class ViewMode {
	readonly #key: string;
	#value = $state<EntityViewMode>("list");

	/**
	 * Reads the stored mode for this list off the protected layout's
	 * preferences; must be constructed during component init.
	 *
	 * @param key Identifies the list, so each page remembers its own mode.
	 * @param fallback Used when nothing is stored for this list yet.
	 */
	constructor(key: string, fallback: EntityViewMode = "list") {
		this.#key = key;
		this.#value = storedViewMode(
			page.data.preferences?.viewModes,
			key,
			fallback,
		);
	}

	/** The active view mode, reactive. */
	get current(): EntityViewMode {
		return this.#value;
	}

	/** Switches the view mode at once and saves it to the account's preferences, switching back if the save fails. */
	set current(next: EntityViewMode) {
		if (next === this.#value) {
			return;
		}
		const previous = this.#value;
		this.#value = next;
		void toast.promise(this.#save(next, previous), {
			error: (error) => toastError(error, "Couldn't save the view."),
			loading: `Saving ${LABELS[next].toLowerCase()}`,
			success: `${LABELS[next]} saved.`,
		});
	}

	/**
	 * Persists `next` and mirrors it onto the layout's cached preferences, so
	 * coming back to this page later in the session opens in the new mode;
	 * restores `previous` before rethrowing when the save fails.
	 */
	async #save(next: EntityViewMode, previous: EntityViewMode): Promise<void> {
		try {
			await setViewMode({ key: this.#key, mode: next });
		} catch (error) {
			this.#value = previous;
			throw error;
		}
		const preferences = page.data.preferences;
		if (preferences) {
			preferences.viewModes = { ...preferences.viewModes, [this.#key]: next };
		}
	}
}
