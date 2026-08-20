import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { ProjectDTO } from "$lib/dto/project-dto";
import { RemoteHostDTO } from "$lib/dto/remote-host-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { TemplateDTO } from "$lib/dto/template-dto";
import { Logger } from "$lib/logger";
import { parseCronSchedule } from "$lib/server/cron";
import { encryptSecret } from "$lib/server/docker/secrets";
import { removeContainer } from "$lib/server/docker/service";
import { updateServiceSchema } from "$lib/server/validation/service";

const logger = new Logger("Services");

export const load = async ({ parent }) => {
	const { user } = await parent();
	const [projects, remoteHosts] = await Promise.all([
		ProjectDTO.list(user.id),
		RemoteHostDTO.list(user.id),
	]);

	return {
		projects: projects.map((p) => p.toJSON()),
		remoteHosts: remoteHosts.map((h) => h.toJSON()),
	};
};

export const actions = {
	delete: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		if (svc.containerId) {
			try {
				const remote = await RemoteHostDTO.connectionFor(svc, locals.user.id);
				await removeContainer(svc.containerId, { force: true }, remote);
			} catch {
				// Container may already be gone proceed with deleting the record.
			}
		}
		await svc.delete();
		logger.info(`Service deleted: service=${svc.id} user=${locals.user.id}`);
		throw redirect(303, resolve("/services"));
	},
	moveProject: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const rawProjectId = formData.get("projectId") as string | null;

		// Empty selection means "ungrouped" — otherwise confirm the target
		// project is actually the user's own, never trust the form value alone.
		let projectId: string | null = null;
		if (rawProjectId) {
			const proj = await ProjectDTO.get(rawProjectId, locals.user.id);
			if (!proj) {
				return fail(400, { error: "That project wasn't found." });
			}
			projectId = proj.id;
		}

		await svc.update({ projectId });
		logger.info(
			`Service moved: service=${svc.id} project=${projectId ?? "none"} user=${locals.user.id}`,
		);
		return { moved: true };
	},
	moveRemoteHost: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId, locals.user.id);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const rawHostId = formData.get("remoteHostId") as string | null;

		// Empty selection means "this host" — otherwise confirm the target
		// host is actually the user's own, never trust the form value alone.
		let remoteHostId: string | null = null;
		if (rawHostId) {
			const host = await RemoteHostDTO.get(rawHostId, locals.user.id);
			if (!host) {
				return fail(400, { error: "That remote host wasn't found." });
			}
			remoteHostId = host.id;
		}

		await svc.update({ remoteHostId });
		logger.info(
			`Service deploy target changed: service=${svc.id} remoteHost=${remoteHostId ?? "local"} user=${locals.user.id}`,
		);
		return { movedHost: true };
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
		const result = updateServiceSchema.safeParse(Object.fromEntries(formData));
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

		const isGitBuild = input.buildSource === "git";

		await svc.update({
			buildSource: input.buildSource,
			dnsResolvable: input.dnsResolvable,
			name: input.name,
			registryUrl: input.registryUrl || null,
			registryUsername: input.registryUsername || null,
			slug: input.slug,
			// Blank password field means "leave unchanged" — never
			// overwrite a stored credential with nothing just because
			// the user didn't retype it.
			...(input.registryPassword
				? { registryPasswordEnc: encryptSecret(input.registryPassword) }
				: {}),
			containerPort: input.containerPort,
			cpuLimit: input.cpuLimit || null,
			memoryLimitMb: input.memoryLimitMb ?? null,
			restartPolicy: input.restartPolicy,
			...(isGitBuild
				? {
						gitBuildContext: input.gitBuildContext || null,
						gitDockerfilePath: input.gitDockerfilePath || null,
						gitRef: input.gitRef || null,
						gitUrl: input.gitUrl || null,
					}
				: {
						gitBuildContext: null,
						gitDockerfilePath: null,
						gitRef: null,
						gitUrl: null,
						image: input.image,
						tag: input.tag,
					}),
		});

		logger.info(
			`Service settings updated: service=${svc.id} user=${locals.user.id}`,
		);
		return { success: true };
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

		if (cronEnabled && !parseCronSchedule(cronSchedule)) {
			return fail(400, {
				cronError:
					'Invalid schedule — use standard 5-field cron syntax (e.g. "0 3 * * *").',
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
