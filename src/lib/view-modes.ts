export const VIEW_MODES = ["list", "card"] as const;

/** How a list page draws its rows: a list or a grid of cards. */
export type EntityViewMode = (typeof VIEW_MODES)[number];

/** The shape of a list page's key in `user_preferences.view_modes`: lowercase words joined by dashes. */
export const VIEW_MODE_KEY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Narrows a stored value to a view mode. */
export function isViewMode(value: unknown): value is EntityViewMode {
	return value === "list" || value === "card";
}

/** The mode a list page renders in: the account's stored choice for `key`, else `fallback`. */
export function storedViewMode(
	stored: Record<string, unknown> | null | undefined,
	key: string,
	fallback: EntityViewMode,
): EntityViewMode {
	const value = stored?.[key];
	return isViewMode(value) ? value : fallback;
}
