import { RedirectDTO } from "$lib/dto/redirect-dto";
import { redirectSchema } from "$lib/server/validation/redirect";

/**
 * Validates a redirect (the form's entries, or an API body merged over the
 * stored row) and checks its source isn't taken by another redirect (`selfId`
 * is the one being edited). Returns the first error message, or the
 * normalized fields.
 */
export async function parseRedirectInput(
	input: Record<string, unknown>,
	selfId?: string,
) {
	const result = redirectSchema.safeParse(input);
	if (!result.success) {
		return { error: result.error.issues[0]?.message ?? "Invalid redirect." };
	}
	const taken = await RedirectDTO.getBySource(result.data.source);
	if (taken && taken.toJSON().id !== selfId) {
		return { error: `${result.data.source} already has a redirect.` };
	}
	return { fields: result.data };
}
