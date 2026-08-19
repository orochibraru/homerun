import { redirect } from "@sveltejs/kit";
import { eq } from "drizzle-orm";
import { resolve } from "$app/paths";
import { db } from "$lib/server/db/lib";
import { profile } from "$lib/server/db/schema";
import type { LayoutServerLoad } from "./$types";

export const load: LayoutServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, resolve("/auth/sign-in"));

	const userProfile = await db
		.select()
		.from(profile)
		.where(eq(profile.userId, locals.user.id))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	return {
		user: locals.user,
		profile: userProfile,
	};
};
