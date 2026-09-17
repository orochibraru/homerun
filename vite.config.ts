import process from "node:process";
import adapter from "@orochibraru/svelte-smol";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

process.env.BUN_FEATURE_FLAG_EXPERIMENTAL_HTTP2_CLIENT = "1";

/**
 * Publishes the port the dev or preview server actually bound to as `PORT`, so
 * `$lib/config.ts` builds the login wall's default auth-check URL against it
 * instead of the production default of 3000. Runs before the first request,
 * which is when SvelteKit first loads the server modules.
 */
function listeningPortPlugin(): Plugin {
	const publish = (httpServer: ViteDevServer["httpServer"]) => {
		httpServer?.once("listening", () => {
			const address = httpServer.address();
			if (address && typeof address === "object") {
				process.env.PORT = String(address.port);
			}
		});
	};
	return {
		configurePreviewServer: (server) => publish(server.httpServer),
		configureServer: (server) => publish(server.httpServer),
		name: "homerun-listening-port",
	};
}

export default defineConfig({
	plugins: [
		listeningPortPlugin(),
		tailwindcss(),
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes("node_modules") ? undefined : true,
			},
			adapter: adapter(),
			csrf: { trustedOrigins: ["*"] },
			experimental: {
				// Enables src/instrumentation.server.ts, which the svelte-smol
				// adapter loads before the rest of the compiled server bundle.
				// Used here purely to force reflect-metadata to initialise first,
				// see that file.
				instrumentation: {
					server: true,
				},
				remoteFunctions: true,
			},
		}),
	],

	server: {
		// Traefik's forwardAuth middleware (see docker/labels.ts's
		// authRequired) calls this app from inside a container as
		// http://host.docker.internal:<port>/api/v1/auth-check : without
		// this, Vite dev mode's own Host-header guard rejects that request
		// before it reaches any route. Only relevant to `vite dev`; the
		// built app (`bun run start`) has no such restriction.
		allowedHosts: ["host.docker.internal"],
	},
	build: {
		target: "es2022",
		cssMinify: true,
		reportCompressedSize: false,
		rollupOptions: {
			output: {
				manualChunks(id) {
					if (id.includes("node_modules/svelte")) {
						return "svelte";
					}
					if (id.includes("node_modules")) {
						return "vendor";
					}
				},
			},
		},
	},
});
