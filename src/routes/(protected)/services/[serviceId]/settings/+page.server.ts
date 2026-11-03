import { fail } from "@sveltejs/kit";

import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { TemplateDTO } from "#lib/dto/template-dto.js";
import { Logger } from "#lib/logger.js";
import { can } from "#lib/permissions.js";
import { normalizeEnvironmentName } from "#lib/release-channels.js";
import { listIconLibrary } from "#lib/server/icon-library.js";
import { redirectToSignIn } from "#lib/server/sign-in-redirect.js";
import { updateGeneralSchema } from "#lib/server/validation/service.js";
import { runtimeOptionsFrom } from "#lib/service-runtime.js";
import {
	ServiceSettingsError,
	ServiceSettingsService,
} from "#lib/services/service-settings.service.js";

const logger = new Logger("Services");

export const load = async () => {
	const [stacks, icons] = await Promise.all([
		StackDTO.list(),
		listIconLibrary(),
	]);
	return { icons, stacks: stacks.map((p) => p.toJSON()) };
};

export const actions = {
	update: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
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
			environmentName: normalizeEnvironmentName(input.environmentName),
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

	updateIdentity: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const category = String(formData.get("category") ?? "");
		const icon = String(formData.get("icon") ?? "");
		const saved = await ServiceSettingsService.save(
			svc,
			{ category: category || null, icon: icon || null },
			{
				hostAccess: can(locals.permissions, "system", "write"),
				userId: locals.user.id,
			},
		);
		if (saved instanceof ServiceSettingsError) {
			return fail(saved.status, { error: saved.message });
		}
		logger.info(
			`Service identity updated: service=${svc.id} category=${category || "none"} icon=${icon.startsWith("data:") ? "upload" : icon || "none"} user=${locals.user.id}`,
		);
		return { identitySaved: true };
	},

	moveStack: async ({ request, params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const stackId =
			((await request.formData()).get("stackId") as string | null) || null;
		const saved = await ServiceSettingsService.save(
			svc,
			{ stackId },
			{
				hostAccess: can(locals.permissions, "system", "write"),
				userId: locals.user.id,
			},
		);
		if (saved instanceof ServiceSettingsError) {
			return fail(saved.status, { error: saved.message });
		}
		logger.info(
			`Service moved: service=${svc.id} stack=${stackId ?? "none"} user=${locals.user.id}`,
		);
		return { moved: true };
	},

	saveAsTemplate: async ({ params, locals }) => {
		if (!locals.user) {
			redirectToSignIn();
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		await TemplateDTO.create({
			...runtimeOptionsFrom(svc.toJSON()),
			containerPort: svc.containerPort,
			cpuLimit: svc.cpuLimit,
			description: `Saved from ${svc.name}`,
			envVars: svc.envVars,
			healthcheckCommand: svc.healthcheckCommand,
			image: svc.image,
			memoryLimitMb: svc.memoryLimitMb,
			name: svc.name,
			ownerId: locals.user.id,
			publishedPorts: svc.publishedPorts,
			restartPolicy: svc.restartPolicy,
			tag: svc.tag,
		});

		logger.info(
			`Template saved from service: service=${svc.id} user=${locals.user.id}`,
		);
		return { templateSaved: true };
	},
};
