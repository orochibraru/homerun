import { json } from "@sveltejs/kit";
import { and, count, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { like } from "$lib/server/db/schema";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) {
		return json({ error: "Unauthorized" }, { status: 401 });
	}

	const body = await request.json().catch(() => null);
	if (!body?.carId || typeof body.carId !== "string") {
		return json({ error: "carId is required" }, { status: 400 });
	}

	const userId = locals.user.id;
	const { carId } = body;

	// Check if already liked
	const existing = await db
		.select({ id: like.id })
		.from(like)
		.where(and(eq(like.userId, userId), eq(like.carId, carId)))
		.limit(1);

	if (existing.length > 0) {
		// Unlike — remove the row
		await db.delete(like).where(eq(like.id, existing[0].id));
	} else {
		// Like — insert a new row
		await db.insert(like).values({
			id: crypto.randomUUID(),
			userId,
			carId,
			createdAt: new Date(),
		});
	}

	// Return fresh count
	const [{ total }] = await db
		.select({ total: count(like.id) })
		.from(like)
		.where(eq(like.carId, carId));

	return json({ liked: existing.length === 0, count: total });
};
