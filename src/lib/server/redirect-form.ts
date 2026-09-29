import { RedirectDTO } from "$lib/dto/redirect-dto";
import { redirectSchema } from "$lib/server/validation/redirect";

/**
 * Validates the redirect form and checks its source isn't taken by another
 * redirect (`selfId` is the one being edited). Returns the first error
 * message, or the normalized fields.
 */
export async function parseRedirectForm(formData: FormData, selfId?: string) {
	const result = redirectSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) {
		return { error: result.error.issues[0]?.message ?? "Invalid redirect." };
	}
	const taken = await RedirectDTO.getBySource(result.data.source);
	if (taken && taken.toJSON().id !== selfId) {
		return { error: `${result.data.source} already has a redirect.` };
	}
	return { fields: result.data };
}
