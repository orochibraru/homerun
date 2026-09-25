import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { CronJobDTO } from "$lib/dto/cron-job-dto";
import { CronJobRunDTO } from "$lib/dto/cron-job-run-dto";
import { BASE_SORTS, sortKeysOf } from "$lib/list-sorts";
import { Logger } from "$lib/logger";
import { parseListQuery } from "$lib/server/list-query";
import { enqueueCronJobRun } from "$lib/services/cron-job-queue";

const logger = new Logger("CronJob");

export const load = async ({ parent, url }) => {
	await parent();
	const query = parseListQuery(url, {
		filterKeys: ["kind", "enabled"],
		sortKeys: sortKeysOf(BASE_SORTS),
	});
	const [paged, runs] = await Promise.all([
		CronJobDTO.listPaged(query),
		CronJobRunDTO.listRecent(),
	]);
	return {
		filtered: query.active,
		jobs: paged.items.map((j) => j.toJSON()),
		page: paged.page,
		perPage: paged.perPage,
		runs: runs.map((r) => ({ jobName: r.jobName, run: r.run.toJSON() })),
		total: paged.total,
	};
};

export const actions = {
	delete: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const jobId = formData.get("jobId") as string | null;
		const job = jobId ? await CronJobDTO.get(jobId) : null;
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
		return { success: true };
	},

	runNow: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const jobId = formData.get("jobId") as string | null;
		const job = jobId ? await CronJobDTO.get(jobId) : null;
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
};
