import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { parseScope } from "#lib/iac/generate.js";
import { can, permissionDeniedMessage } from "#lib/permissions.js";
import { apiCaller, apiError } from "#lib/server/api-route.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";

export const GET = async ({ locals, url }) => {
	const caller = apiCaller(locals);
	if ("refused" in caller) {
		return caller.refused;
	}
	const scope = parseScope(url.searchParams.get("scope"));
	if (!scope) {
		return apiError("scope is stack:<id or slug> or service:<id or slug>.");
	}
	const scopeArea = scope.kind === "stack" ? "stacks" : "services";
	if (!can(caller.permissions, scopeArea)) {
		return apiError(permissionDeniedMessage(scopeArea, "read"), 403);
	}
	const projectId = url.searchParams.get("project");
	const project = projectId ? await IacProjectDTO.get(projectId) : null;
	if (projectId && !project) {
		return apiError("That state project doesn't exist.", 404);
	}
	const origin = config.auth.origin ?? url.origin;
	const generated = await IacInventoryService.structure(caller.userId, scope, {
		backendAddress: project
			? `${origin}/api/v1/iac/projects/${project.id}`
			: null,
		endpoint: origin,
	});
	if (!generated) {
		return apiError("That stack or service doesn't exist.", 404);
	}
	if (url.searchParams.get("format") === "zip") {
		const archive = IacInventoryService.archive(generated);
		return new Response(archive.body, {
			headers: {
				"cache-control": "no-store",
				"content-disposition": `attachment; filename="${archive.filename}"`,
				"content-type": "application/zip",
			},
		});
	}
	return Response.json(
		{
			files: generated.files.map((file) => ({
				content: file.content,
				path: file.path,
			})),
			name: generated.name,
			slug: generated.slug,
		},
		{ headers: { "cache-control": "no-store" } },
	);
};
