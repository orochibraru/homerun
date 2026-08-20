import { json } from "@sveltejs/kit";
import { ApiService } from "$lib/services/api.service";

/**
 * Checked from the create/settings forms as the user fills in image/tag —
 * warns, never blocks: a missing image might just mean the user hasn't
 * pushed it yet, or a private registry needs credentials this check
 * doesn't have.
 */
export const POST = async ({ request, locals }) => {
	if (!locals.user) {
		return new Response("Unauthorized", { status: 401 });
	}

	const body = await request.json();
	const image = typeof body.image === "string" ? body.image.trim() : "";
	const tag =
		typeof body.tag === "string" && body.tag.trim()
			? body.tag.trim()
			: "latest";
	const registryUrl =
		typeof body.registryUrl === "string" && body.registryUrl.trim()
			? body.registryUrl.trim()
			: null;
	const registryUsername =
		typeof body.registryUsername === "string" && body.registryUsername.trim()
			? body.registryUsername.trim()
			: null;
	const registryPassword =
		typeof body.registryPassword === "string" ? body.registryPassword : "";

	if (!image) {
		return json({ checked: false, exists: true });
	}

	const auth = registryUsername
		? { password: registryPassword, username: registryUsername }
		: undefined;

	const result = await ApiService.checkImageExists(
		image,
		tag,
		registryUrl,
		auth,
	);
	return json(result);
};
