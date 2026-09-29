import { error } from "@sveltejs/kit";
import { resolve } from "$app/paths";
import { config } from "$lib/config";
import { DeploymentDTO } from "$lib/dto/deployment-dto";
import { ErrorIssueDTO } from "$lib/dto/error-issue-dto";
import { ServiceDTO } from "$lib/dto/service-dto";
import { StackDTO } from "$lib/dto/stack-dto";
import { serviceHostname } from "$lib/services/dns.service";
import { certResolverFor } from "$lib/services/docker/cert-resolver";
import { ancestorIds } from "$lib/stack-tree";

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
		? [{ href: resolve("/stacks"), label: "Stacks" }, ...trail]
		: [];
	if (!previewParent) {
		return base.length ? base : null;
	}
	return [
		...(base.length
			? base
			: [{ href: resolve("/services"), label: "Services" }]),
		{
			href: resolve("/(protected)/services/[serviceId]", {
				serviceId: previewParent.id,
			}),
			label: previewParent.name,
		},
	];
}

export const load = async ({ params, parent }) => {
	await parent();

	const svc = await ServiceDTO.get(params.serviceId);
	if (!svc) {
		error(404, "Service not found");
	}

	const previewParentId = svc.toJSON().previewParentId;
	const [stack, [lastDeploy], stacks, openErrors, previewParent] =
		await Promise.all([
			svc.stackId ? StackDTO.get(svc.stackId) : null,
			DeploymentDTO.listRevisions(svc.id, 1),
			svc.stackId ? StackDTO.list() : [],
			ErrorIssueDTO.countOpenByService([svc.id]),
			previewParentId ? ServiceDTO.get(previewParentId) : null,
		]);
	const parents = new Map(stacks.map((s) => [s.id, s.parentId]));
	const trail = stack
		? [...ancestorIds(stack.id, parents).reverse(), stack.id].map((id) => ({
				href: resolve("/(protected)/stacks/[stackId]", { stackId: id }),
				label: stacks.find((s) => s.id === id)?.name ?? stack.name,
			}))
		: [];

	return {
		baseDomain: config.baseDomain,
		behindPangolin: config.pangolinEnabled,
		crumbRoot: crumbRoot(trail, previewParent),
		certResolver: certResolverFor(
			serviceHostname(svc.slug, stack?.slug),
			config.traefik.certResolver,
			config.pangolinEnabled,
			config.traefik.instanceCertNames,
		),
		lastDeployedAt: lastDeploy
			? (lastDeploy.toJSON().finishedAt ?? lastDeploy.toJSON().createdAt)
			: null,
		openErrors: openErrors.get(svc.id) ?? 0,
		stackSlug: stack?.slug ?? null,
		publicScheme: config.traefik.entrypoint === "web" ? "http" : "https",
		service: svc.toJSON(),
	};
};
