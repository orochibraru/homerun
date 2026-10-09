import { fail } from "@sveltejs/kit";
import { Logger } from "#lib/logger.js";
import {
	API_KEY_EXPIRY_OPTIONS,
	type Permissions,
	toApiKeyPermissions,
} from "#lib/permissions.js";
import { auth } from "#lib/services/auth.js";

const logger = new Logger("ApiKeys");

/**
 * The `createApiKey` form action of the IaC pages: an API key holding the
 * permissions its owner has today (not whatever they're granted later),
 * which the Terraform provider and the state backend both authenticate with.
 *
 * @returns The key, shown once, or a 400 failure.
 */
export async function createIacApiKeyAction(
	userId: string,
	permissions: Permissions,
	formData: FormData,
) {
	const name = String(formData.get("name") ?? "").trim() || "IaC";
	const expiry = API_KEY_EXPIRY_OPTIONS.find(
		(option) => option.value === formData.get("expiry"),
	);
	if (!expiry) {
		return fail(400, { error: "Pick when the key expires." });
	}
	try {
		const created = await auth.api.createApiKey({
			body: {
				expiresIn: expiry.days ? expiry.days * 86_400 : null,
				name,
				permissions: toApiKeyPermissions(permissions),
				userId,
			},
		});
		logger.info(
			`API key created from IaC: name=${name} expiry=${expiry.value} user=${userId}`,
		);
		return { apiKey: created.key, success: true };
	} catch (error) {
		logger.warn("Couldn't create API key", {
			error: error instanceof Error ? error.message : String(error),
		});
		return fail(400, { error: "Couldn't create an API key." });
	}
}
