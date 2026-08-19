import { fail, redirect } from "@sveltejs/kit";
import { and, eq, ne } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { profile } from "$lib/server/db/schema";
import type { Actions, PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, resolve("/auth/sign-in"));
	// profile is already loaded by the dashboard layout load
	return {};
};

export const actions: Actions = {
	updateProfile: async ({ request, locals }) => {
		if (!locals.user) redirect(302, resolve("/auth/sign-in"));

		const data = await request.formData();
		const username = (data.get("username") as string | null)?.trim() ?? "";
		const bio =
			(data.get("bio") as string | null)?.trim().slice(0, 300) || null;
		const location =
			(data.get("location") as string | null)?.trim().slice(0, 100) || null;
		const isPublic = data.get("isPublic") === "true";

		// ── Validate username ────────────────────────────────────────
		if (!username) {
			return fail(400, { profileError: "Username is required." });
		}
		if (!/^[a-z0-9_-]{3,32}$/.test(username)) {
			return fail(400, {
				profileError:
					"Username must be 3–32 characters and only contain lowercase letters, numbers, underscores, or hyphens.",
			});
		}

		// ── Check uniqueness ─────────────────────────────────────────
		const taken = await db
			.select({ id: profile.id })
			.from(profile)
			.where(
				and(eq(profile.username, username), ne(profile.userId, locals.user.id)),
			)
			.limit(1);

		if (taken.length > 0) {
			return fail(400, { profileError: "That username is already taken." });
		}

		// ── Upsert ───────────────────────────────────────────────────
		const now = new Date();
		await db
			.insert(profile)
			.values({
				id: crypto.randomUUID(),
				userId: locals.user.id,
				username,
				bio,
				location,
				isPublic,
				createdAt: now,
				updatedAt: now,
			})
			.onConflictDoUpdate({
				target: profile.userId,
				set: { username, bio, location, isPublic, updatedAt: now },
			});

		return { profileSuccess: true };
	},
};
