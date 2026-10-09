import { parseScope } from "#lib/iac/generate.js";
import { providerSnippets } from "#lib/iac/provider-snippets.js";
import { IAC_TOOL_INFO, usesHttpBackend } from "#lib/iac/tools.js";
import { highlightCode } from "#lib/server/shiki.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";

export const load = async ({ parent, url }) => {
	const { origin, project, user } = await parent();
	const snippets = await Promise.all(
		providerSnippets(origin, project.tool).map(async (snippet) => ({
			...snippet,
			html: await highlightCode(snippet.code, snippet.language),
		})),
	);
	const scope = usesHttpBackend(project.tool)
		? parseScope(url.searchParams.get("scope") ?? project.scope)
		: null;
	const generated = scope
		? await IacInventoryService.structure(user.id, scope, {
				backendAddress: `${origin}/api/v1/iac/projects/${project.id}`,
				cli: IAC_TOOL_INFO[project.tool].cli,
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
		scope: generated && scope ? `${scope.kind}:${scope.id}` : "",
		snippets,
	};
};
