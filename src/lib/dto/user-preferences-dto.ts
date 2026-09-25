import { eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { type UserPreferences, userPreferences } from "$lib/server/db/schema";
import { BaseDTO } from "./base-dto";

export type ThemePreference = "light" | "dark" | "system";

/**
 * Wraps the `user_preferences` table : one row per user, the /profile/appearance
 * tab's backing store. Unlike InstanceSettingsDTO's single instance-wide
 * singleton row, this is genuinely per-user, keyed by userId itself rather
 * than a separate id + unique index (same reasoning as a join table's
 * composite key).
 */
export class UserPreferencesDTO extends BaseDTO<UserPreferences> {
	/** Selects one user's preferences row, creating a default one on first read. */
	static async get(userId: string): Promise<UserPreferencesDTO> {
		const [existing] = await db
			.select()
			.from(userPreferences)
			.where(eq(userPreferences.userId, userId))
			.limit(1);
		if (existing) {
			return new UserPreferencesDTO(existing);
		}

		const now = new Date();
		const row: UserPreferences = {
			accentColor: null,
			createdAt: now,
			palette: null,
			theme: "system",
			updatedAt: now,
			userId,
		};
		await db.insert(userPreferences).values(row).onConflictDoNothing();
		return new UserPreferencesDTO(row);
	}

	/** Persists the user's light/dark/system theme choice. */
	async updateTheme(theme: ThemePreference): Promise<void> {
		await this.persist({ theme });
	}

	/**
	 * Saves the colour choice: a palette by id, or a custom accent colour, or
	 * neither for the built-in default. The two are exclusive, so setting one
	 * clears the other.
	 */
	async updateColors(
		choice: { palette: string } | { accentColor: string } | null,
	): Promise<void> {
		await this.persist({
			accentColor:
				choice && "accentColor" in choice ? choice.accentColor : null,
			palette: choice && "palette" in choice ? choice.palette : null,
		});
	}

	/** Persists a partial field update to this row, in DB and locally. */
	private async persist(
		input: Partial<Omit<UserPreferences, "createdAt" | "updatedAt" | "userId">>,
	): Promise<void> {
		await db
			.update(userPreferences)
			.set(input)
			.where(eq(userPreferences.userId, this.row.userId));
		Object.assign(this.row, input);
	}
}
