import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { parseCronJobForm } from "$lib/server/cron-job-form";

const logger = new Logger("CronJob");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const hosts = await RemoteHostDTO.list(user.id);
	return {
		canUseExec: user.role === "admin",
		remoteHosts: hosts
			.filter((host) => host.kind === "docker")
			.map((host) => ({ id: host.id, name: host.name })),
	};
};

export const actions = {
	create: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}

		const formData = await request.formData();
		const result = parseCronJobForm(formData, {
			isAdmin: Boolean(locals.isAdmin),
		});
		if ("error" in result) {
			return fail(400, { error: result.error });
		}

		const job = await CronJobDTO.create({
			...result.parsed,
			userId: locals.user.id,
		});
		logger.info(
			`Cron job created: job=${job.id} kind=${job.kind} user=${locals.user.id}`,
		);
		redirect(303, `${resolve("/cron-jobs")}/${job.id}`);
	},
};
