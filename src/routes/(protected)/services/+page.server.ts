import { fail, redirect } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { BASE_SORTS, sortKeysOf } from "$lib/list-sorts";
import { Logger } from "$lib/logger";
import { parseListQuery } from "$lib/server/list-query";
import { allowLongRequest } from "$lib/server/long-request";
import { dependencyMap, toGraphService } from "$lib/service-graph";
import {
	buildLinkEnv,
	defaultUrlKey,
	defaultVarPrefix,
	detectLinkEngine,
	linkRoles,
} from "$lib/service-link";
import { ServiceLifecycleService } from "$lib/services/service-lifecycle.service";
import { uniqueSlug } from "$lib/slug";

const logger = new Logger("Services");

const SLUG_STRIP_RE = /[^a-z0-9]+/g;
const SLUG_TRIM_RE = /^-+|-+$/g;

/**
 * Puts two linked services on one stack network : into whichever stack
 * one of them is already in, or a new one named after the first. Two services
 * only actually reach each other by slug once they share one.
 */
async function groupPair(
	svc: ServiceDTO,
	target: ServiceDTO,
	userId: string,
): Promise<string> {
	const existing = svc.stackId ?? target.stackId;
	const stackId =
		existing ??
		(
			await StackDTO.create({
				name: svc.name,
				slug: await uniqueSlug(slugify(svc.name) || "stack", (slug) =>
					StackDTO.slugTaken(slug),
				),
				userId,
			})
		).id;

	await Promise.all(
		[svc, target]
			.filter((row) => row.stackId !== stackId)
			.map((row) => row.update({ stackId })),
	);
	return stackId;
}

function slugify(name: string): string {
	return name
		.toLowerCase()
		.replace(SLUG_STRIP_RE, "-")
		.replace(SLUG_TRIM_RE, "")
		.slice(0, 63);
}

const BULK_OPS = ["delete", "restart", "start", "stop"] as const;

type BulkOp = (typeof BULK_OPS)[number];

const OP_PAST_TENSE: Record<BulkOp, string> = {
	delete: "deleted",
	restart: "restarted",
	start: "started",
	stop: "stopped",
};

async function loadServices(url: URL) {
	const query = parseListQuery(url, {
		filterKeys: ["status", "stack"],
		sortKeys: sortKeysOf(BASE_SORTS),
	});
	const paged = await ServiceDTO.listWithStackNamesPaged(query);

	return {
		services: paged.items.map((r) => ({
			...r.service.toJSON(),
			stackName: r.stackName,
		})),
		total: paged.total,
	};
}

async function runOp(op: BulkOp, svc: ServiceDTO, userId: string) {
	if (op === "delete") {
		await ServiceLifecycleService.deleteService(svc);
	} else if (op === "start") {
		await ServiceLifecycleService.startService(svc);
	} else if (op === "stop") {
		await ServiceLifecycleService.stopService(svc);
	} else {
		await ServiceLifecycleService.restartService(svc);
	}
	logger.info(`Service ${OP_PAST_TENSE[op]}: service=${svc.id} user=${userId}`);
}

async function runSingle(op: BulkOp, formData: FormData, userId: string) {
	const serviceId = formData.get("serviceId");
	if (typeof serviceId !== "string" || !serviceId) {
		return fail(400, { error: "Missing service id." });
	}

	const svc = await ServiceDTO.get(serviceId);
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
		await Promise.all(parsed.ids.map((id) => ServiceDTO.get(id)))
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
	await parent();
	const query = parseListQuery(url, {
		filterKeys: ["status", "stack"],
		sortKeys: sortKeysOf(BASE_SORTS),
	});
	const treeView = url.searchParams.get("view") === "tree";
	const [{ services, total }, facets, stacks, everything] = await Promise.all([
		loadServices(url),
		ServiceDTO.listFilterFacets(),
		StackDTO.list(),
		treeView ? ServiceDTO.list() : null,
	]);

	return {
		baseDomain: config.baseDomain,
		facets,
		filtered: query.active,
		page: query.page,
		perPage: query.perPage,
		stacks: stacks.map((p) => ({
			id: p.id,
			name: p.name,
			parentId: p.parentId,
			slug: p.slug,
		})),
		services,
		total,
		tree: everything && {
			deps: Object.fromEntries(
				dependencyMap(
					everything.map((svc) => ({
						envVars: svc.envVars,
						id: svc.id,
						slug: svc.slug,
					})),
				),
			),
			services: everything.map((svc) => toGraphService(svc.toJSON())),
		},
	};
};

export const actions = {
	/**
	 * Writes the connection variables for `targetId` into `serviceId`'s own
	 * env, the same values the wizard's link picker would have produced. The
	 * context menu's "Link to…" : a service that needs a database shouldn't
	 * mean retyping a URL that Homerun can derive.
	 */
	link: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const serviceId = formData.get("serviceId") as string | null;
		const targetId = formData.get("targetId") as string | null;
		const format = (formData.get("format") as string | null) ?? "url";
		if (!(serviceId && targetId)) {
			return fail(400, { error: "Pick a service to link to." });
		}

		const [source, picked] = await Promise.all([
			ServiceDTO.get(serviceId),
			ServiceDTO.get(targetId),
		]);
		if (!(source && picked)) {
			return fail(404, { error: "Service not found." });
		}
		const { consumer: svc, provider: target } = linkRoles(source, picked);

		const engine = detectLinkEngine(target.image);
		const linkTarget = {
			command: target.command,
			containerPort: target.containerPort,
			envVars: target.envVars,
			image: target.image,
			name: target.name,
			slug: target.slug,
		};
		const rows = buildLinkEnv({
			format:
				format === "vars" || format === "jdbc" || format === "postgresql"
					? format
					: "url",
			prefix: defaultVarPrefix(engine, linkTarget),
			target: linkTarget,
			urlKey: defaultUrlKey(engine, linkTarget),
		});

		await svc.update({
			envVars: {
				...svc.envVars,
				...Object.fromEntries(rows.map((row) => [row.key, row.value])),
			},
		});

		const groupedInto =
			formData.get("alsoGroup") === "on"
				? await groupPair(svc, target, locals.user.id)
				: null;

		logger.info(
			`Service linked: service=${svc.id} target=${target.id} stack=${groupedInto ?? "none"} user=${locals.user.id}`,
		);
		return {
			consumer: svc.name,
			grouped: groupedInto !== null,
			linked: rows.map((row) => row.key),
			success: true,
		};
	},

	/** Moves a service into a stack, creating one when `newStackName` is given. */
	group: async ({ request, locals }) => {
		if (!locals.user) {
			throw redirect(302, resolve("/auth/sign-in"));
		}
		const formData = await request.formData();
		const serviceIds = formData.getAll("serviceId").map(String).filter(Boolean);
		const stackId = (formData.get("stackId") as string | null) || null;
		const newStackName =
			(formData.get("newStackName") as string | null)?.trim() || null;
		if (serviceIds.length === 0) {
			return fail(400, { error: "Nothing to move." });
		}

		let targetStackId = stackId;
		if (newStackName) {
			const slug = slugify(newStackName);
			if (await StackDTO.slugTaken(slug)) {
				return fail(400, { error: "A stack with that slug already exists." });
			}
			const stack = await StackDTO.create({
				name: newStackName,
				slug,
				userId: locals.user.id,
			});
			targetStackId = stack.id;
		}

		const services = await Promise.all(
			serviceIds.map((id) => ServiceDTO.get(id)),
		);
		await Promise.all(
			services
				.filter((svc) => svc !== null)
				.map((svc) => svc.update({ stackId: targetStackId })),
		);
		logger.info(
			`Services grouped: services=${serviceIds.join(",")} stack=${targetStackId ?? "none"} user=${locals.user.id}`,
		);
		return { grouped: serviceIds.length, success: true };
	},

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
