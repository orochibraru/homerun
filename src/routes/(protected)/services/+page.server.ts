import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { parseListQuery } from "$lib/server/list-query";
import { allowLongRequest } from "$lib/server/long-request";
import { DockerService } from "$lib/services/docker.service";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";

const logger = new Logger("Services");

const BULK_OPS = ["delete", "restart", "start", "stop"] as const;

type BulkOp = (typeof BULK_OPS)[number];

const OP_PAST_TENSE: Record<BulkOp, string> = {
	delete: "deleted",
	restart: "restarted",
	start: "started",
	stop: "stopped",
};

async function loadServices(userId: string, url: URL) {
	const query = parseListQuery(url, { filterKeys: ["status", "project"] });
	const paged = await ServiceDTO.listWithProjectNamesPaged(userId, query);

	const deployed = paged.items.filter(
		(r) => r.service.containerId || r.service.swarmServiceId,
	);
	if (deployed.length === 0) {
		return {
			services: paged.items.map((r) => ({
				...r.service.toJSON(),
				projectName: r.projectName,
			})),
			total: paged.total,
		};
	}

	await DockerService.syncAllServiceStatuses(
		deployed.map((r) => r.service.id),
		userId,
	);
	const fresh = await ServiceDTO.listWithProjectNamesPaged(userId, query);

	return {
		services: fresh.items.map((r) => ({
			...r.service.toJSON(),
			projectName: r.projectName,
		})),
		total: fresh.total,
	};
}

async function runOp(op: BulkOp, svc: ServiceDTO, userId: string) {
	if (op === "delete") {
		await ServiceLifecycleService.deleteService(svc, userId);
	} else if (op === "start") {
		await ServiceLifecycleService.startService(svc, userId);
	} else if (op === "stop") {
		await ServiceLifecycleService.stopService(svc, userId);
	} else {
		await ServiceLifecycleService.restartService(svc, userId);
	}
	logger.info(`Service ${OP_PAST_TENSE[op]}: service=${svc.id} user=${userId}`);
}

async function runSingle(op: BulkOp, formData: FormData, userId: string) {
	const serviceId = formData.get("serviceId");
	if (typeof serviceId !== "string" || !serviceId) {
		return fail(400, { error: "Missing service id." });
	}

	const svc = await ServiceDTO.get(serviceId, userId);
	if (!svc) {
		return fail(404, { error: "Service not found." });
	}

	try {
		await runOp(op, svc, userId);
	} catch (error) {
		return fail(400, {
			error:
				error instanceof Error ? error.message : `Couldn't ${op} this service.`,
		});
	}
	return { success: true };
}

function parseBulk(formData: FormData) {
	const op = formData.get("op");
	if (typeof op !== "string" || !BULK_OPS.includes(op as BulkOp)) {
		return { error: "Unknown bulk action." } as const;
	}
	const ids = formData
		.getAll("serviceId")
		.filter((v): v is string => typeof v === "string" && v.length > 0);
	if (ids.length === 0) {
		return { error: "No services selected." } as const;
	}
	return { ids, op: op as BulkOp } as const;
}

async function runBulk(formData: FormData, userId: string) {
	const parsed = parseBulk(formData);
	if ("error" in parsed) {
		return fail(400, { error: parsed.error });
	}

	const found = (
		await Promise.all(parsed.ids.map((id) => ServiceDTO.get(id, userId)))
	).filter((svc): svc is ServiceDTO => svc !== null);

	const settled = await Promise.allSettled(
		found.map((svc) => runOp(parsed.op, svc, userId)),
	);

	const succeeded = settled.filter((r) => r.status === "fulfilled").length;
	const failed = parsed.ids.length - succeeded;

	if (succeeded === 0) {
		const firstRejection = settled.find((r) => r.status === "rejected");
		return fail(400, {
			error:
				firstRejection?.reason instanceof Error
					? firstRejection.reason.message
					: `Couldn't ${parsed.op} the selected services.`,
		});
	}

	return { failed, op: parsed.op, succeeded, success: true };
}

export const load = async ({ parent, platform, url }) => {
	allowLongRequest(platform);
	const { user } = await parent();
	const query = parseListQuery(url, { filterKeys: ["status", "project"] });
	const [{ services, total }, facets] = await Promise.all([
		loadServices(user.id, url),
		ServiceDTO.listFilterFacets(user.id),
	]);

	return {
		baseDomain: config.baseDomain,
		facets,
		filtered: query.active,
		page: query.page,
		perPage: query.perPage,
		services,
		total,
	};
};

export const actions = {
	bulk: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		return runBulk(await request.formData(), locals.user.id);
	},

	delete: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		return runSingle("delete", await request.formData(), locals.user.id);
	},

	restart: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		return runSingle("restart", await request.formData(), locals.user.id);
	},

	start: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		return runSingle("start", await request.formData(), locals.user.id);
	},

	stop: async ({ request, locals, platform }) => {
		allowLongRequest(platform);
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		return runSingle("stop", await request.formData(), locals.user.id);
	},
};
