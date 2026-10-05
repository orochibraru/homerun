import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { parseScope } from "#lib/iac/generate.js";
import { highlightCode } from "#lib/server/shiki.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { stackPath } from "#lib/stack-tree.js";

export const load = async ({ parent, url }) => {
	const { origin, projects, user } = await parent();
	const [stackRows, serviceRows] = await Promise.all([
		StackDTO.list(),
		ServiceDTO.list(),
	]);
	const stacks = stackRows.map((stack) => ({
		id: stack.id,
		name: stack.name,
		parentId: stack.parentId,
		slug: stack.slug,
	}));
	const projectId = projects.some(
		(project) => project.id === url.searchParams.get("project"),
	)
		? (url.searchParams.get("project") ?? "")
		: "";
	const scope = parseScope(url.searchParams.get("scope"));
	const generated = scope
		? await IacInventoryService.structure(user.id, scope, {
				backendAddress: projectId
					? `${origin}/api/v1/iac/projects/${projectId}`
					: null,
				endpoint: origin,
			})
		: null;
	return {
		files: generated
			? await Promise.all(
					generated.files.map(async (file) => {
						const shown = file.preview ?? file.content;
						return {
							content: shown,
							html: await highlightCode(
								shown,
								/\.tf$|\.tfvars/.test(file.path) ? "hcl" : "text",
							),
							path: file.path,
						};
					}),
				)
			: null,
		name: generated?.name ?? null,
		projectId,
		scope: generated && scope ? `${scope.kind}:${scope.id}` : "",
		scopes: [
			...stacks
				.map((stack) => ({
					group: "Stacks",
					label: stackPath(stack.id, stacks),
					value: `stack:${stack.id}`,
				}))
				.sort((a, b) => a.label.localeCompare(b.label)),
			...serviceRows
				.filter((svc) => svc.toJSON().previewParentId === null)
				.map((svc) => ({
					group: "Services",
					label: svc.name,
					value: `service:${svc.id}`,
				}))
				.sort((a, b) => a.label.localeCompare(b.label)),
		],
	};
};
