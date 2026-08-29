import adapter from "@orochibraru/svelte-smol";

/** @type {import('@sveltejs/kit').Config} */
const config = {
	compilerOptions: {
		// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
		runes: ({ filename }) =>
			filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
	},
	kit: {
		adapter: adapter(),
		experimental: {
			// Enables src/instrumentation.server.ts, which the svelte-smol
			// adapter loads before the rest of the compiled server bundle.
			// Used here purely to force reflect-metadata to initialise first,
			// see that file.
			instrumentation: {
				server: true,
			},
		},
	},
};

export default config;
