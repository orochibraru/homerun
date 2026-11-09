import { packageRegistryUsage } from "#lib/package-registries.js";
import { highlightCode } from "#lib/server/shiki.js";

export const load = async ({ parent }) => {
	const { kind, status } = await parent();
	const snippets = await Promise.all(
		packageRegistryUsage(kind, status.usageUrl, null).map(async (snippet) => ({
			...snippet,
			html: await highlightCode(snippet.code, snippet.language),
		})),
	);
	return { snippets };
};
