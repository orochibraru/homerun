import { StackDTO } from "#lib/dto/stack-dto.js";
import {
	generateConfiguration,
	inventoryCounts,
	scopeToStack,
} from "#lib/iac/generate.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { stackPath } from "#lib/stack-tree.js";

export const load = async ({ parent, url }) => {
	const { origin, projects, user } = await parent();
	const all = (await StackDTO.list()).map((stack) => ({
		id: stack.id,
		name: stack.name,
		parentId: stack.parentId,
		slug: stack.slug,
	}));
	const stackId = all.some(
		(stack) => stack.id === url.searchParams.get("stack"),
	)
		? (url.searchParams.get("stack") ?? "")
		: "";
	const projectId = projects.some(
		(project) => project.id === url.searchParams.get("project"),
	)
		? (url.searchParams.get("project") ?? "")
		: "";
	const inventory = await IacInventoryService.inventory(user.id);
	const scoped = stackId ? scopeToStack(inventory, stackId) : inventory;
	return {
		configuration: generateConfiguration(scoped, {
			backendAddress: projectId
				? `${origin}/api/v1/iac/projects/${projectId}`
				: null,
			endpoint: origin,
			generatedAt: new Date(),
		}),
		counts: inventoryCounts(scoped),
		projectId,
		stackId,
		stacks: all
			.map((stack) => ({ id: stack.id, path: stackPath(stack.id, all) }))
			.sort((a, b) => a.path.localeCompare(b.path)),
	};
};
