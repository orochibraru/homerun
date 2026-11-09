import { pulumiLoginCommand } from "#lib/iac-state.js";
import { parseScope } from "#lib/iac/generate.js";
import { providerSnippets } from "#lib/iac/provider-snippets.js";
import { IAC_TOOL_INFO, usesHttpBackend } from "#lib/iac/tools.js";
import { highlightCode, type ShikiLanguage } from "#lib/server/shiki.js";
import { IacInventoryService } from "#lib/services/iac-inventory.service.js";

function languageOf(path: string): ShikiLanguage {
	if (/\.tf$|\.tfvars/.test(path)) {
		return "hcl";
	}
	if (/\.(ts|json)$/.test(path)) {
		return "typescript";
	}
	return path.endsWith(".sh") ? "shellscript" : "text";
}

export const load = async ({ parent, url }) => {
	const { origin, project, store, user } = await parent();
	const snippets = await Promise.all(
		providerSnippets(origin, project.tool).map(async (snippet) => ({
			...snippet,
			html: await highlightCode(snippet.code, snippet.language),
		})),
	);
	const scope = parseScope(url.searchParams.get("scope") ?? project.scope);
	const pulumiLogin = usesHttpBackend(project.tool)
		? undefined
		: store
			? pulumiLoginCommand({
					bucket: project.bucket,
					endpoint: store.endpoint,
					prefix: project.prefix,
					region: store.region,
					slug: project.slug,
				})
			: null;
	const generated = scope
		? await IacInventoryService.structure(user.id, scope, {
				backendAddress: `${origin}/api/v1/iac/projects/${project.id}`,
				cli: IAC_TOOL_INFO[project.tool].cli,
				endpoint: origin,
				pulumiLogin,
			})
		: null;
	return {
		files: generated
			? await Promise.all(
					generated.files.map(async (file) => {
						const shown = file.preview ?? file.content;
						return {
							content: shown,
							html: await highlightCode(shown, languageOf(file.path)),
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
