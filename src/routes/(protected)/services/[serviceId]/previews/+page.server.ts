import { error, fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import {
	defaultHostname,
	previewDomainTemplateProblem,
} from "$lib/service-domains";
import { GitWebhookService } from "$lib/services/git-webhook.service";
import { PreviewService } from "$lib/services/preview.service";

const logger = new Logger("Previews");

export const load = async ({ params }) => {
	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		error(404, "Service not found");
	}
	const stack = svc.stackId ? await StackDTO.get(svc.stackId) : null;
	return {
		defaultPreviewHostname: defaultHostname(
			`${svc.slug}-pr-<n>`,
			stack?.slug,
			config.baseDomain,
		),
		previews: await PreviewService.list(svc),
		pushWebhook: await GitWebhookService.describe(svc),
	};
};

/** The service behind a previews action, when it's a git-built service that isn't itself a preview. */
async function previewParent(serviceId: string) {
	const svc = await ServiceDTO.get(serviceId);
	if (
		!svc ||
		svc.toJSON().buildSource !== "git" ||
		svc.toJSON().previewParentId
	) {
		return null;
	}
	return svc;
}

export const actions = {
	updatePreviews: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await previewParent(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Previews need a service built from git." });
		}

		const formData = await request.formData();
		const previewsEnabled = formData.get("previewsEnabled") === "on";
		const previewDefaultDomain = formData.get("previewDefaultDomain") === "on";
		const template = String(formData.get("previewDomainTemplate") ?? "")
			.trim()
			.toLowerCase();
		const values = Object.fromEntries(formData);
		const problem = template ? previewDomainTemplateProblem(template) : null;
		if (problem) {
			return fail(400, {
				errors: { previewDomainTemplate: [problem] },
				values,
			});
		}
		if (!(template || previewDefaultDomain)) {
			return fail(400, {
				errors: {
					previewDomainTemplate: [
						"Set a domain template, or keep the default hostname: a preview needs at least one.",
					],
				},
				values,
			});
		}

		const before = svc.toJSON();
		const previousWebhook = {
			gitProviderId: svc.gitProviderId,
			gitRepo: svc.gitRepo,
			gitWebhookId: svc.gitWebhookId,
			previewsEnabled: before.previewsEnabled,
		};
		await svc.update({
			previewDefaultDomain,
			previewDomainTemplate: template || null,
			previewsEnabled,
		});
		await GitWebhookService.sync(svc, previousWebhook);
		if (before.previewsEnabled && !previewsEnabled) {
			await PreviewService.removeAll(svc);
		} else if (
			before.previewDefaultDomain !== previewDefaultDomain ||
			(before.previewDomainTemplate ?? "") !== template
		) {
			await PreviewService.applyDomains(svc);
		}

		logger.info(
			`Preview settings updated: service=${svc.id} enabled=${previewsEnabled} template=${template || "-"} user=${locals.user.id}`,
		);
		return { success: true };
	},

	redeploy: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await previewParent(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const previewId = String((await request.formData()).get("previewId"));
		try {
			await PreviewService.redeploy(svc, previewId);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return { success: true };
	},

	delete: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await previewParent(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		const previewId = String((await request.formData()).get("previewId"));
		try {
			await PreviewService.delete(svc, previewId);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		return { success: true };
	},
};
