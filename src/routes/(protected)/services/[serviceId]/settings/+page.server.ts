import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { Logger } from "$lib/logger";
import { allowLongRequest } from "$lib/server/long-request";
import { updateGeneralSchema } from "$lib/server/validation/service";
import { CronService } from "$lib/services/cron.service";
import { deleteDns, serviceHostname } from "$lib/services/dns.service";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("Services");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const stacks = await StackDTO.list(user.id);

	return { stacks: stacks.map((p) => p.toJSON()) };
};

export const actions = {
	delete: async ({ params, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		if (svc.swarmServiceId) {
			try {
				await DockerService.removeSwarmService(svc.swarmServiceId);
			} catch {
				// Service may already be gone on the swarm : proceed regardless.
			}
		} else if (svc.containerId) {
			try {
				await ServiceLifecycleService.remove(svc.containerId);
			} catch {
				// Container may already be gone proceed with deleting the record.
			}
		}
		if (svc.dnsResolvable) {
			const stack = svc.stackId
				? await StackDTO.get(svc.stackId, locals.user.id)
				: null;
			const customDomain = svc.toJSON().customDomain;
			await deleteDns([
				serviceHostname(svc.slug, stack?.slug),
				...(customDomain ? [customDomain] : []),
			]);
		}
		await svc.delete();
		logger.info(`Service deleted: service=${svc.id} user=${locals.user.id}`);
		throw redirect(303, resolve("/services"));
	},
	moveStack: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const rawStackId = formData.get("stackId") as string | null;

		// Empty selection means "ungrouped" : otherwise confirm the target
		// stack is actually the user's own, never trust the form value alone.
		let stackId: string | null = null;
		if (rawStackId) {
			const stack = await StackDTO.get(rawStackId, locals.user.id);
			if (!stack) {
				return fail(400, { error: "That stack wasn't found." });
			}
			stackId = stack.id;
		}

		await svc.update({ stackId });
		logger.info(
			`Service moved: service=${svc.id} stack=${stackId ?? "none"} user=${locals.user.id}`,
		);
		return { moved: true };
	},
	saveAsTemplate: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		await TemplateDTO.create({
			containerPort: svc.containerPort,
			cpuLimit: svc.cpuLimit,
			description: `Saved from ${svc.name}`,
			envVars: svc.envVars,
			healthcheckCommand: svc.healthcheckCommand,
			image: svc.image,
			memoryLimitMb: svc.memoryLimitMb,
			name: svc.name,
			ownerId: locals.user.id,
			restartPolicy: svc.restartPolicy,
			tag: svc.tag,
		});

		logger.info(
			`Template saved from service: service=${svc.id} user=${locals.user.id}`,
		);
		return { templateSaved: true };
	},
	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const result = updateGeneralSchema.safeParse(Object.fromEntries(formData));
		if (!result.success) {
			return fail(400, {
				errors: result.error.flatten().fieldErrors,
				values: Object.fromEntries(formData),
			});
		}
		const input = result.data;

		if (
			input.slug !== svc.slug &&
			(await ServiceDTO.slugTaken(input.slug, svc.id))
		) {
			return fail(400, {
				errors: { slug: ["That slug is already in use."] },
				values: Object.fromEntries(formData),
			});
		}

		await svc.update({
			healthcheckCommand: input.healthcheckCommand || null,
			name: input.name,
			pullPolicy: input.pullPolicy,
			restartPolicy: input.restartPolicy,
			slug: input.slug,
		});

		logger.info(
			`Service settings updated: service=${svc.id} user=${locals.user.id}`,
		);
		return { success: true };
	},
	updateImageScan: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const formData = await request.formData();
		const imageScanEnabled = formData.get("imageScanEnabled") === "on";
		await svc.update({ imageScanEnabled });
		logger.info(
			`Image scanning updated: service=${svc.id} enabled=${imageScanEnabled} user=${locals.user.id}`,
		);
		return { imageScanSaved: true };
	},
	updateCron: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const cronEnabled = formData.get("cronEnabled") === "on";
		const cronSchedule =
			(formData.get("cronSchedule") as string | null)?.trim() ?? "";

		if (cronEnabled && !CronService.parseCronSchedule(cronSchedule)) {
			return fail(400, {
				cronError:
					'Invalid schedule : use standard 5-field cron syntax (e.g. "0 3 * * *").',
			});
		}

		await svc.update({
			cronEnabled,
			cronSchedule: cronSchedule || null,
		});

		logger.info(
			`Cron schedule updated: service=${svc.id} enabled=${cronEnabled} schedule="${cronSchedule}" user=${locals.user.id}`,
		);
		return { cronSaved: true };
	},
};
