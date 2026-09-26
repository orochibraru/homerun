import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import {
	isOauthMethod,
	oauthMethod,
	oauthProviderName,
	PASSWORD_METHOD,
} from "$lib/auth-providers";
import { config } from "$lib/config";
import { ImageScanDTO } from "$lib/dto/image-scan-dto";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { invalidateGatedService } from "$lib/server/gated-service-cache";
import { DeploymentService } from "$lib/services/deploy.service";
import { ImageScanService } from "$lib/services/image-scan.service";
import { UserService } from "$lib/services/user.service";

const logger = new Logger("ImageScan");
const accessLogger = new Logger("Services");

const EMAIL_PATTERN_RE = /^(\*|[^\s@]+)@[^\s@]+\.[^\s@]+$/;

function splitList(raw: string | null): string[] {
	return [
		...new Set(
			(raw ?? "")
				.split(/[\n,]/)
				.map((entry) => entry.trim())
				.filter(Boolean),
		),
	];
}

export const load = async ({ locals, params, parent }) => {
	await parent();
	const [scans, scanning, settings, users] = await Promise.all([
		ImageScanDTO.listForService(params.serviceId, 15),
		ImageScanService.isScanning(params.serviceId),
		InstanceSettingsDTO.get(),
		UserService.listUsers(),
	]);
	return {
		blockPolicy: settings.imageScanBlockPolicy,
		dashboardOrigin: config.auth.origin ?? null,
		instanceScanEnabled: settings.imageScanEnabled,
		isAdmin: locals.isAdmin,
		oauthProviders: config.auth.oauthProviders
			.filter((p) => p.enabled)
			.map((p) => ({
				label: p.label || p.name,
				method: oauthMethod(p.name),
				name: p.name,
			})),
		scanning,
		scans: scans.map((scan) => scan.toJSON()),
		users: users.map((u) => ({
			email: u.email,
			id: u.id,
			name: u.name,
			role: u.role,
		})),
	};
};

export const actions = {
	scan: async ({ params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}
		if (!(svc.containerId || svc.swarmServiceId)) {
			return fail(400, {
				error: "Deploy the service first : there's no deployed image to scan.",
			});
		}
		const job = await ImageScanService.enqueueScan(svc, locals.user.id);
		logger.info(
			`Image scan queued: service=${svc.id} job=${job.id} user=${locals.user.id}`,
		);
		return { queued: true };
	},
	updateAppAuth: async ({ request, params, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const svc = await ServiceDTO.get(params.serviceId);
		if (!svc) {
			return fail(404, { error: "Service not found." });
		}

		const formData = await request.formData();
		const authRequired = formData.get("authRequired") === "on";
		const methods = [...new Set(formData.getAll("authProvider").map(String))];
		const allowedUserIds = [
			...new Set(formData.getAll("authAllowedUserId").map(String)),
		];
		const allowedEmails = splitList(
			formData.get("authAllowedEmails") as string | null,
		);
		const allowedGroups = splitList(
			formData.get("authAllowedGroups") as string | null,
		);

		const enabledOauth = new Set(
			config.auth.oauthProviders.filter((p) => p.enabled).map((p) => p.name),
		);
		for (const method of methods) {
			const providerName = oauthProviderName(method);
			const known =
				method === PASSWORD_METHOD ||
				(isOauthMethod(method) &&
					!!providerName &&
					enabledOauth.has(providerName));
			if (!known) {
				return fail(400, {
					authError: `"${method}" isn't an enabled sign-in method on this instance.`,
				});
			}
		}
		if (authRequired && methods.length === 0) {
			return fail(400, {
				authError:
					"Pick at least one sign-in method, otherwise nobody (including you) can get into this app.",
			});
		}
		if (authRequired && !config.auth.origin) {
			return fail(400, {
				authError:
					"Set the Dashboard URL under Settings → General first : the login wall redirects visitors to this instance's own sign-in page, so Homerun has to know its own public URL.",
			});
		}
		const badEmail = allowedEmails.find(
			(entry) => !EMAIL_PATTERN_RE.test(entry),
		);
		if (badEmail) {
			return fail(400, {
				authError: `"${badEmail}" isn't an email address or a *@domain pattern.`,
			});
		}

		const wasRequired = svc.authRequired;
		await svc.update({
			authAllowedEmails: allowedEmails,
			authAllowedGroups: allowedGroups,
			authAllowedUserIds: allowedUserIds,
			authProviders: methods,
			authRequired,
		});
		invalidateGatedService(svc.id);
		const redeploying = await DeploymentService.redeployIfLoginWallChanged(
			svc,
			wasRequired,
			locals.user.id,
		);

		accessLogger.info(
			`App access updated: service=${svc.id} authRequired=${authRequired} methods=${
				methods.join("|") || "none"
			} user=${locals.user.id}`,
		);
		return { authSuccess: true, redeploying };
	},
};
