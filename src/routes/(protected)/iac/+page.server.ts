import { listOwnApiKeys } from "#lib/server/api-keys.js";

export const load = async ({ request }) => ({
	apiKeyCount: (await listOwnApiKeys(request.headers)).length,
});
