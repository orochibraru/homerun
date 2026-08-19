import { error } from "@sveltejs/kit";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { car, follow, mod, profile, user } from "$lib/server/db/schema";
import type { PageServerLoad } from "./[username]/$types";

export const load: PageServerLoad = async ({ locals }) => {
	// ── Load profile by username ──────────────────────────────────
	const profileRow = await db
		.select({
			profile,
			owner: {
				id: user.id,
				name: user.name,
				image: user.image,
				createdAt: user.createdAt,
			},
		})
		.from(profile)
		.innerJoin(user, eq(profile.userId, user.id))
		.where(eq(profile.userId, locals.user.id))
		.limit(1)
		.then((rows) => rows[0] ?? null);

	if (!profileRow?.profile.isPublic) {
		error(404, "Profile not found");
	}

	const userId = profileRow.profile.userId;

	// ── Public cars with mod stats ────────────────────────────────
	const carsRaw = await db
		.select({
			car,
			modCount: count(mod.id),
			totalSpend: sql<number>`coalesce(sum(${mod.price} + ${mod.laborCost}), 0)`,
		})
		.from(car)
		.leftJoin(mod, and(eq(mod.carId, car.id), eq(mod.isPublic, true)))
		.where(and(eq(car.userId, userId), eq(car.isPublic, true)))
		.groupBy(car.id)
		.orderBy(desc(car.createdAt));

	// ── Follower / following counts ───────────────────────────────
	const [{ followerCount }] = await db
		.select({ followerCount: count(follow.id) })
		.from(follow)
		.where(eq(follow.followingId, userId));

	const [{ followingCount }] = await db
		.select({ followingCount: count(follow.id) })
		.from(follow)
		.where(eq(follow.followerId, userId));

	// ── Is the current user following this profile? ───────────────
	let isFollowing = false;
	if (locals.user && locals.user.id !== userId) {
		const followRow = await db
			.select({ id: follow.id })
			.from(follow)
			.where(
				and(
					eq(follow.followerId, locals.user.id),
					eq(follow.followingId, userId),
				),
			)
			.limit(1);
		isFollowing = followRow.length > 0;
	}

	const totalModCount = carsRaw.reduce((sum, c) => sum + c.modCount, 0);

	return {
		profile: profileRow.profile,
		owner: profileRow.owner,
		cars: carsRaw.map((c) => ({
			...c.car,
			modCount: c.modCount,
			totalSpend: Number(c.totalSpend),
		})),
		stats: {
			carCount: carsRaw.length,
			modCount: totalModCount,
			followerCount,
			followingCount,
		},
		isFollowing,
		isSelf: locals.user?.id === userId,
		currentUserId: locals.user?.id ?? null,
	};
};
