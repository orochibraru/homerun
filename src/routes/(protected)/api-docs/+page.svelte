<script lang="ts">
	import "swagger-ui-dist/swagger-ui.css";
	import { onMount } from "svelte";
	import { title } from "$lib/store/title";

	let container: HTMLDivElement | undefined = $state();

	onMount(() => {
		title.set("API Docs");

		// Dynamically imported client-side only — swagger-ui-bundle touches
		// `window`/`document` at call time, which would crash SvelteKit's SSR
		// pass if imported at module scope.
		(async () => {
			const { default: SwaggerUIBundle } = await import(
				"swagger-ui-dist/swagger-ui-bundle.js"
			);
			SwaggerUIBundle({
				dom_id: undefined,
				domNode: container,
				presets: [SwaggerUIBundle.presets.apis],
				url: "/api/v1/openapi.json",
			});
		})();
	});
</script>

<div class="flex h-full flex-col gap-4">
	<div>
		<h1 class="text-text text-xl font-semibold">API Docs</h1>
		<p class="text-text-muted text-sm">
			The REST API's live OpenAPI spec — served at <code
				class="bg-surface-2 rounded px-1 py-0.5 text-xs">/api/v1/openapi.json</code
			>, generated straight from the same zod schemas that validate each
			request (see CLAUDE.md's OpenAPI section). Every request here needs
			your own <code class="bg-surface-2 rounded px-1 py-0.5 text-xs"
				>x-api-key</code
			> header to actually succeed — "Try it out" won't be authenticated by your
			browser session.
		</p>
	</div>
	<!-- Swagger UI ships its own dark styling that doesn't follow this app's
	     theme tokens — wrapped in a light-background card so it reads
	     correctly regardless of the dashboard's own dark/light mode. -->
	<div class="min-h-0 flex-1 overflow-auto rounded-2xl bg-white p-2">
		<div bind:this={container}></div>
	</div>
</div>
