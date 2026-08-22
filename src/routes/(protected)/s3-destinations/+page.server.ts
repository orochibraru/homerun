import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { S3DestinationDTO } from "$lib/dto/s3-destination-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("S3Destinations");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const destinations = await S3DestinationDTO.list(user.id);
	return { destinations: destinations.map((d) => d.toJSON()) };
};

export const actions = {
	delete: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const destinationId = formData.get("destinationId") as string | null;
		if (!destinationId) {
			return fail(400, { error: "Missing destination id." });
		}

		const destination = await S3DestinationDTO.get(
			destinationId,
			locals.user.id,
		);
		if (!destination) {
			return fail(404, { error: "Destination not found." });
		}

		await destination.delete();
		logger.info(
			`S3 destination deleted: destination=${destinationId} user=${locals.user.id}`,
		);
		return { success: true };
	},
};
