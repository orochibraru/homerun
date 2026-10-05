import { providerSnippets } from "#lib/iac/provider-snippets.js";
import { highlightCode } from "#lib/server/shiki.js";

export const load = async ({ parent }) => {
	const { origin } = await parent();
	return {
		snippets: await Promise.all(
			providerSnippets(origin).map(async (snippet) => ({
				...snippet,
				html: await highlightCode(snippet.code, snippet.language),
			})),
		),
	};
};
