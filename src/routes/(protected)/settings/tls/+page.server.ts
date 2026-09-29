import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { Logger } from "$lib/logger";
import { applyAndRebuild } from "$lib/server/validation/instance-settings-form";
import { serviceHostnames } from "$lib/service-domains";
import { DeploymentService } from "$lib/services/deploy.service";
import { DockerService } from "$lib/services/docker.service";
import { certificateCovers, inspectCertificate } from "$lib/tls-certificate";

const logger = new Logger("InstanceSettings");

/** The deployed services with a hostname the certificate covers, which need a redeploy to stop asking Let's Encrypt for it. */
async function coveredServices(names: string[]) {
	if (names.length === 0) {
		return [];
	}
	const [services, stacks] = await Promise.all([
		ServiceDTO.list(),
		StackDTO.list(),
	]);
	const slugs = new Map(stacks.map((stack) => [stack.id, stack.slug]));
	return services.filter(
		(svc) =>
			(svc.containerId || svc.swarmServiceId) &&
			svc.dnsResolvable &&
			serviceHostnames(
				svc.toJSON(),
				svc.stackId ? slugs.get(svc.stackId) : null,
				config.baseDomain,
			).some((host) => certificateCovers(names, host)),
	);
}

export const load = async () => {
	const settings = await InstanceSettingsDTO.get();
	const certificate = settings.instanceCertificate;
	const covered = await coveredServices(certificate?.names ?? []);
	return {
		behindPangolin: config.pangolinEnabled,
		certificate,
		coveredServices: covered.map((svc) => ({ id: svc.id, name: svc.name })),
		dynamicConfigDir: config.traefik.dynamicConfigDir ?? null,
	};
};

/** The admin guard every action here shares. */
function requireAdmin(locals: App.Locals): string {
	if (!locals.user) {
		throw redirect(302, resolve("/auth/sign-in"));
	}
	if (!locals.isAdmin) {
		throw redirect(302, resolve("/"));
	}
	return locals.user.id;
}

export const actions = {
	install: async ({ request, locals }) => {
		const userId = requireAdmin(locals);
		const formData = await request.formData();
		const cert = String(formData.get("cert") ?? "").trim();
		const key = String(formData.get("key") ?? "").trim();
		let info: ReturnType<typeof inspectCertificate>;
		try {
			info = inspectCertificate(cert, key);
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		try {
			await DockerService.syncInstanceCertificate({ cert, key });
		} catch (err) {
			return fail(400, {
				error: err instanceof Error ? err.message : String(err),
			});
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.updateInstanceCertificate({ ...info, cert, key });
		applyAndRebuild(settings);
		logger.info(
			`Instance certificate installed: names=${info.names.join(",")} user=${userId}`,
		);
		return { installed: info.names.join(", "), success: true };
	},

	remove: async ({ locals }) => {
		const userId = requireAdmin(locals);
		const settings = await InstanceSettingsDTO.get();
		await settings.updateInstanceCertificate(null);
		applyAndRebuild(settings);
		await DockerService.syncInstanceCertificate(null).catch((err) => {
			logger.warn("Couldn't remove the instance certificate file", err);
		});
		logger.info(`Instance certificate removed: user=${userId}`);
		return { removed: true, success: true };
	},

	redeployCovered: async ({ locals }) => {
		const userId = requireAdmin(locals);
		const settings = await InstanceSettingsDTO.get();
		const services = await coveredServices(
			settings.instanceCertificate?.names ?? [],
		);
		for (const svc of services) {
			// oxlint-disable-next-line no-await-in-loop -- each enqueue writes its own deployment row, the queue serialises them anyway
			await DeploymentService.enqueueDeploy({ svc, userId });
		}
		logger.info(
			`Redeploy queued for ${services.length} service(s) the instance certificate covers: user=${userId}`,
		);
		return { redeployed: services.length, success: true };
	},
};
