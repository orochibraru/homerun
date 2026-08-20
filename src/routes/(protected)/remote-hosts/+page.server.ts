import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";

const logger = new Logger("RemoteHosts");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const hosts = await RemoteHostDTO.list(user.id);
	return { hosts: hosts.map((h) => h.toJSON()) };
};

export const actions = {
	delete: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const hostId = formData.get("hostId") as string | null;
		if (!hostId) {
			return fail(400, { error: "Missing host id." });
		}

		const host = await RemoteHostDTO.get(hostId, locals.user.id);
		if (!host) {
			return fail(404, { error: "Remote host not found." });
		}

		await host.delete();
		logger.info(`Remote host deleted: host=${hostId} user=${locals.user.id}`);
		return { success: true };
	},
};
