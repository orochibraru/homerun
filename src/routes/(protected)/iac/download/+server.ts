import { config } from "#lib/config.js";
import { IacProjectDTO } from "#lib/dto/iac-project-dto.js";
import { parseScope } from "#lib/iac/generate.js";
import { zipFiles } from "#lib/server/zip.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";

export const GET = async ({ locals, url }) => {
	if (!locals.user) {
		return Response.json({ error: "Unauthorized" }, { status: 401 });
	}
	if (!locals.isAdmin) {
		return Response.json({ error: "Admins only." }, { status: 403 });
	}
	const scope = parseScope(url.searchParams.get("scope"));
	if (!scope) {
		return Response.json(
			{ error: "Pick a stack or a service." },
			{ status: 400 },
		);
	}
	const origin = config.auth.origin ?? url.origin;
	const project = url.searchParams.get("project")
		? await IacProjectDTO.get(url.searchParams.get("project") ?? "")
		: null;
	const generated = await IacInventoryService.structure(locals.user.id, scope, {
		backendAddress: project
			? `${origin}/api/v1/iac/projects/${project.id}`
			: null,
		endpoint: origin,
	});
	if (!generated) {
		return Response.json(
			{ error: "That stack or service doesn't exist." },
			{ status: 404 },
		);
	}
	const folder = `${generated.slug}-terraform`;
	return new Response(
		zipFiles(
			generated.files.map((file) => ({
				content: file.content,
				path: `${folder}/${file.path}`,
			})),
		),
		{
			headers: {
				"cache-control": "no-store",
				"content-disposition": `attachment; filename="${folder}.zip"`,
				"content-type": "application/zip",
			},
		},
	);
};
