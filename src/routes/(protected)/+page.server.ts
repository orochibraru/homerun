import { redirect } from "@sveltejs/kit";
import { desc, eq } from "drizzle-orm";
import { db } from "$lib/server/db/lib";
import { car, mod } from "$lib/server/db/schema";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(302, "/auth");

	const [cars, allMods] = await Promise.all([
		db.select().from(car).where(eq(car.userId, locals.user.id)),
		db.select().from(mod).where(eq(mod.userId, locals.user.id)),
	]);

	const totalSpent = allMods.reduce((sum, m) => sum + m.price + m.laborCost, 0);

	const mostExpensiveMod = allMods.reduce<(typeof allMods)[0] | null>(
		(best, m) => {
			const total = m.price + m.laborCost;
			const bestTotal = best ? best.price + best.laborCost : -1;
			return total > bestTotal ? m : best;
		},
		null,
	);

	// Recent 5 mods with their car info — join via carId
	const recentModsRaw = await db
		.select({
			mod,
			carNickname: car.nickname,
			carMake: car.make,
			carModel: car.model,
			carYear: car.year,
		})
		.from(mod)
		.leftJoin(car, eq(mod.carId, car.id))
		.where(eq(mod.userId, locals.user.id))
		.orderBy(desc(mod.createdAt))
		.limit(5);

	const recentMods = recentModsRaw.map((r) => ({
		...r.mod,
		carLabel: r.carNickname ?? `${r.carYear} ${r.carMake} ${r.carModel}`,
	}));

	return {
		stats: {
			totalSpent,
			carCount: cars.length,
			modCount: allMods.length,
			mostExpensiveMod,
		},
		recentMods,
	};
};
