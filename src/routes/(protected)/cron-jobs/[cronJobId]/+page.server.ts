import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { CronJobRunDTO } from "$lib/dto/cron-job-run-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { Logger } from "$lib/logger";
import { parseCronJobForm } from "$lib/server/cron-job-form";
import { enqueueCronJobRun } from "$lib/services/cron-job-queue";

const logger = new Logger("CronJob");

export const load = async ({ params, parent }) => {
	const { user } = await parent();
	const job = await CronJobDTO.get(params.cronJobId);
	if (!job) {
		error(404, "Cron job not found");
	}
	const [runs, hosts] = await Promise.all([
		CronJobRunDTO.listForJob(job.id),
		RemoteHostDTO.list(),
	]);
	return {
		canUseExec: user.role === "admin",
		job: job.toJSON(),
		remoteHosts: hosts
			.filter((host) => host.kind === "docker")
			.map((host) => ({ id: host.id, name: host.name })),
		runs: runs.map((r) => r.toJSON()),
	};
};

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const job = await CronJobDTO.get(params.cronJobId);
		if (!job) {
			return fail(404, { error: "Cron job not found." });
		}
		if (job.kind === "exec" && !locals.isAdmin) {
			return fail(403, {
				error: "Only an admin can manage a host command job.",
			});
		}

		await job.delete();
		logger.info(`Cron job deleted: job=${job.id} user=${locals.user.id}`);
		redirect(303, resolve("/cron-jobs"));
	},

	runNow: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const job = await CronJobDTO.get(params.cronJobId);
		if (!job) {
			return fail(404, { error: "Cron job not found." });
		}
		if (job.kind === "exec" && !locals.isAdmin) {
			return fail(403, {
				error: "Only an admin can manage a host command job.",
			});
		}

		const entry = await enqueueCronJobRun(job);
		logger.info(`Cron job run queued: job=${job.id} queued=${entry.id}`);
		return { queued: true };
	},

	update: async ({ params, request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const job = await CronJobDTO.get(params.cronJobId);
		if (!job) {
			return fail(404, { error: "Cron job not found." });
		}
		if (job.kind === "exec" && !locals.isAdmin) {
			return fail(403, {
				error: "Only an admin can manage a host command job.",
			});
		}

		const formData = await request.formData();
		const result = parseCronJobForm(formData, {
			isAdmin: Boolean(locals.isAdmin),
		});
		if ("error" in result) {
			return fail(400, { error: result.error });
		}

		const { registryPasswordEnc, ...rest } = result.parsed;
		await job.update({
			...rest,
			...(registryPasswordEnc ? { registryPasswordEnc } : {}),
		});
		logger.info(`Cron job updated: job=${job.id} user=${locals.user.id}`);
		return { success: true };
	},
};
