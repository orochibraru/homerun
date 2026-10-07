import { fail, redirect } from "@sveltejs/kit";
import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { ObjectStoreDTO } from "#lib/dto/object-store-dto.js";
import { ServiceDTO } from "#lib/dto/service-dto.js";
import { StackDTO } from "#lib/dto/stack-dto.js";
import { parseScope } from "#lib/iac/generate.js";
import { highlightCode } from "#lib/server/shiki.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";
import { IacStateService } from "#lib/services/iac-state.service.js";
import { stackPath } from "#lib/stack-tree.js";
import { resolve } from "$app/paths";

export const load = async ({ parent, url }) => {
	const { origin, projects, user } = await parent();
	const [stackRows, serviceRows, storeRows, settings] = await Promise.all([
		StackDTO.list(),
		ServiceDTO.list(),
		ObjectStoreDTO.list(),
		InstanceSettingsDTO.get(),
	]);
	const builtinEnabled = settings.toJSON().garageEnabled === true;
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
					name: stack.name,
					value: `stack:${stack.id}`,
				}))
				.sort((a, b) => a.label.localeCompare(b.label)),
			...serviceRows
				.filter((svc) => svc.toJSON().previewParentId === null)
				.map((svc) => ({
					group: "Services",
					label: svc.name,
					name: svc.name,
					value: `service:${svc.id}`,
				}))
				.sort((a, b) => a.label.localeCompare(b.label)),
		],
		stores: storeRows
			.filter((store) => store.kind !== "garage" || builtinEnabled)
			.map((store) => store.summary()),
	};
};

export const actions = {
	createBackend: async ({ locals, request }) => {
		if (!locals.user) {
			throw redirect(302, resolve("auth/sign-in"));
		}
		const formData = await request.formData();
		try {
			const project = await IacStateService.createProject({
				bucket: String(formData.get("bucket") ?? "").trim(),
				name: String(formData.get("name") ?? ""),
				prefix: String(formData.get("prefix") ?? ""),
				storeId: String(formData.get("storeId") ?? ""),
				userId: locals.user.id,
			});
			return { projectId: project.id };
		} catch (cause) {
			return fail(400, {
				error: cause instanceof Error ? cause.message : String(cause),
			});
		}
	},
};
