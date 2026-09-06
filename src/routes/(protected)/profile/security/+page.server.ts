import { eq } from "drizzle-orm";
import { config } from "$lib/config";
import { db } from "$lib/server/db/lib";
import { account as accountTable } from "$lib/server/db/schema";

export const load = async ({ parent }) => {
	const { user } = await parent();

	const rows = await db
		.select({
			accountId: accountTable.accountId,
			providerId: accountTable.providerId,
		})
		.from(accountTable)
		.where(eq(accountTable.userId, user.id));
	const linked = new Map(rows.map((row) => [row.providerId, row.accountId]));

	return {
		hasPassword: linked.has("credential"),
		providers: config.auth.oauthProviders
			.filter((provider) => provider.enabled)
			.map((provider) => ({
				accountId: linked.get(provider.name) ?? null,
				linked: linked.has(provider.name),
				name: provider.name,
			})),
	};
};
