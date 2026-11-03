import { resolve } from "$app/paths";
import { error } from "@sveltejs/kit";

import { config, serviceDomain } from "#lib/config.js";
import { DeploymentDTO } from "#lib/dto/deployment-dto.js";
import { ErrorIssueDTO } from "#lib/dto/error-issue-dto.js";
import { ImageScanDTO } from "#lib/dto/image-scan-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { ServiceGitDTO } from "#lib/dto/service-git-dto.js";
import { ServiceVolumeDTO } from "#lib/dto/service-volume-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { TrafficSampleDTO } from "#lib/dto/traffic-sample-dto.js";
import { serviceHostname } from "#lib/services/dns.service.js";
import { certResolverFor } from "#lib/services/docker/cert-resolver.js";
import { RevisionService } from "#lib/services/revision.service.js";
import { UserService } from "#lib/services/user.service.js";
import { ancestorIds } from "#lib/stack-tree.js";

/**
 * The crumbs standing in for `/services`: the stack trail for a service in a
 * stack, and for a pull request preview its parent service after that (or
 * after Services), so a preview never reads as a top-level service.
 */
function crumbRoot(
	trail: { href: string; label: string }[],
	previewParent: ServiceDTO | null,
) {
	const base = trail.length
		? [{ href: resolve("stacks"), label: "Stacks" }, ...trail]
		: [];
	if (!previewParent) {
		return base.length ? base : null;
	}
	return [
		...(base.length
			? base
			: [{ href: resolve("services"), label: "Services" }]),
		{
			href: resolve("/(protected)/services/[serviceId]", {
				serviceId: previewParent.id,
			}),
			label: previewParent.name,
		},
	];
}

/**
 * Whether the header offers a one-click rollback: only in the simple UI, where
 * the Revisions list that does it otherwise is hidden, and only when there's a
 * previous revision to go back to.
 */
async function canRollBack(svc: ServiceDTO, uiMode: string): Promise<boolean> {
	if (uiMode !== "simple") {
		return false;
	}
	const revisions = await RevisionService.list(svc.toJSON());
	return revisions.some((revision) => revision.previous);
}

/** Who deployed `deployment` by hand, null for one a push, a schedule or a promote started. */
async function deployerName(
	deployment: DeploymentDTO | undefined,
): Promise<string | null> {
	if (deployment?.toJSON().trigger !== "manual") {
		return null;
	}
	return (await UserService.getUser(deployment.toJSON().userId))?.name ?? null;
}

export const load = async ({ params, parent }) => {
	const { uiMode } = await parent();

	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		error(404, "Service not found");
	}

	const previewParentId = svc.toJSON().previewParentId;
	const [
		stack,
		[lastDeploy],
		[lastAttempt],
		stacks,
		openErrors,
		previewParent,
		traffic,
		mounts,
		latestScan,
		rollBack,
	] = await Promise.all([
		svc.stackId ? StackDTO.get(svc.stackId) : null,
		DeploymentDTO.listRevisions(svc.id, 1),
		DeploymentDTO.listForService(svc.id, 1),
		svc.stackId ? StackDTO.list() : [],
		ErrorIssueDTO.countOpenByService([svc.id]),
		previewParentId ? ServiceDTO.get(previewParentId) : null,
		TrafficSampleDTO.totals([svc.id], new Date(Date.now() - 86_400_000)),
		ServiceVolumeDTO.listForService(svc.id),
		ImageScanDTO.latestForService(svc.id),
		canRollBack(svc, uiMode),
	]);
	const deployedBy = await deployerName(lastDeploy);
	const scan = latestScan?.toJSON();
	const root = previewParentId
		? svc.toJSON().previewPrNumber === null
			? previewParent
			: null
		: svc;
	const [environments, canary] = root
		? await Promise.all([
				ServiceGitDTO.listEnvironments(root.id),
				ServiceGitDTO.getCanary(root.id),
			])
		: [[], null];
	const parents = new Map(stacks.map((s) => [s.id, s.parentId]));
	const trail = stack
		? [...ancestorIds(stack.id, parents).reverse(), stack.id].map((id) => ({
				href: resolve("/(protected)/stacks/[stackId]", { stackId: id }),
				label: stacks.find((s) => s.id === id)?.name ?? stack.name,
			}))
		: [];

	return {
		baseDomain: config.baseDomain,
		serviceDomain: serviceDomain(),
		behindPangolin: config.pangolinEnabled,
		crumbRoot: crumbRoot(trail, previewParent),
		certResolver: certResolverFor(
			serviceHostname(svc.slug, stack?.slug),
			config.traefik.certResolver,
			config.pangolinEnabled,
			config.traefik.instanceCertNames,
		),
		canRollBack: rollBack,
		deployedBy,
		lastDeployedAt: lastDeploy
			? (lastDeploy.toJSON().finishedAt ?? lastDeploy.toJSON().createdAt)
			: null,
		environments: root
			? [
					{
						id: root.id,
						name: root.toJSON().environmentName ?? "production",
					},
					...environments.map((env) => ({
						id: env.id,
						name: env.toJSON().environmentName ?? env.name,
					})),
					...(canary ? [{ id: canary.id, name: "canary" }] : []),
				]
			: [],
		lastDeployment: lastAttempt
			? {
					at: lastAttempt.toJSON().finishedAt ?? lastAttempt.toJSON().createdAt,
					id: lastAttempt.id,
					status: lastAttempt.toJSON().status,
				}
			: null,
		latestScan: scan
			? { at: scan.scannedAt, counts: scan.counts, status: scan.status }
			: null,
		mountCount: mounts.length,
		openErrors: openErrors.get(svc.id) ?? 0,
		traffic,
		stackSlug: stack?.slug ?? null,
		publicScheme: config.traefik.entrypoint === "web" ? "http" : "https",
		service: svc.toJSON(),
	};
};
