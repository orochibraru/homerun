import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { StorageVolumeDTO } from "$lib/dto/storage-volume-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("Storage");

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const kind = formData.get("kind") as string | null;
		const source = (formData.get("source") as string | null)?.trim() ?? "";
		const description =
			(formData.get("description") as string | null)?.trim() || null;

		if (!name) {
			return fail(400, { error: "Name is required." });
		}
		if (kind !== "bind" && kind !== "volume") {
			return fail(400, { error: "Choose a volume type." });
		}
		if (!source) {
			return fail(400, {
				error:
					kind === "bind"
						? "Host path is required."
						: "Volume name is required.",
			});
		}
		if (kind === "bind" && !source.startsWith("/")) {
			return fail(400, { error: "Host path must be absolute (start with /)." });
		}

		const vol = await StorageVolumeDTO.create({
			description,
			kind,
			name,
			source,
			userId: locals.user.id,
		});

		logger.info(
			`Storage volume created: volume=${vol.id} kind=${kind} user=${locals.user.id}`,
		);
		redirect(303, resolve("/storage"));
	},
};
