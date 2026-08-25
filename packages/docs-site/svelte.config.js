import adapter from "@sveltejs/adapter-static";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// A fully static build : this site has no server-side state of its own
		// (every guide page is pre-rendered from ../../docs/*.md at build time,
		// see src/lib/docs-content.ts, and docs/[slug]/+page.ts's `entries()`
		// enumerates every known slug up front), so it can be hosted anywhere
		// plain files can, no Bun/Node runtime required unlike the main app, and
		// no SPA fallback is needed since nothing here is resolved at request
		// time.
		adapter: adapter(),
	},
	preprocess: vitePreprocess(),
};

export default config;
