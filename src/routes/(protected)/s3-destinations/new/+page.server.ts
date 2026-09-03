import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("S3Destinations");

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const name = (formData.get("name") as string | null)?.trim() ?? "";
		const endpoint = (formData.get("endpoint") as string | null)?.trim() ?? "";
		const bucket = (formData.get("bucket") as string | null)?.trim() ?? "";
		const region = (formData.get("region") as string | null)?.trim() ?? "";
		const accessKeyId =
			(formData.get("accessKeyId") as string | null)?.trim() ?? "";
		const secretAccessKey =
			(formData.get("secretAccessKey") as string | null)?.trim() ?? "";

		if (
			!(name && endpoint && bucket && region && accessKeyId && secretAccessKey)
		) {
			return fail(400, { error: "Every field is required." });
		}
		if (!URL.canParse(endpoint)) {
			return fail(400, { error: "Endpoint must be a full URL." });
		}

		const destination = await S3DestinationDTO.create({
			accessKeyId,
			bucket,
			endpoint,
			name,
			region,
			secretAccessKey,
			userId: locals.user.id,
		});

		logger.info(
			`S3 destination added: destination=${destination.id} user=${locals.user.id}`,
		);

		return { success: true };
	},
};
