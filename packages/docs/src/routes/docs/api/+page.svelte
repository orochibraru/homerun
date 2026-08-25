<script lang="ts">
	import "swagger-ui-dist/swagger-ui.css";
	import { onMount } from "svelte";

	let container: HTMLDivElement | undefined = $state();

	onMount(() => {
		// Dynamically imported client-side only, same as the main dashboard's
		// own api-docs page : swagger-ui-bundle touches `window`/`document` at
		// call time, which would crash SvelteKit's SSR/prerender pass otherwise.
		(async () => {
			const { default: SwaggerUIBundle } = await import(
				"swagger-ui-dist/swagger-ui-bundle.js"
			);
			SwaggerUIBundle({
				dom_id: undefined,
				domNode: container,
				presets: [SwaggerUIBundle.presets.apis],
				url: "/openapi.json",
			});
		})();
	});
</script>

<svelte:head>
	<title>API reference — Homerun docs</title>
</svelte:head>

<div class="max-w-3xl">
  <h1 class="mb-2 text-2xl font-bold tracking-tight">API reference</h1>
  <p class="mb-6 text-sm leading-relaxed text-(--text-muted)">
    The live OpenAPI 3.1 spec Homerun's own <code>/api/v1/openapi.json</code>
    serves, generated from the same zod schemas that validate each request
    (see <a href="/docs/api-and-cli">API & CLI</a> and CLAUDE.md's OpenAPI
    section). This copy is a snapshot taken at build time from this repo's own
    checked-in <code>openapi.json</code>, "Try it out" here won't have a real
    instance behind it, point it at your own instance's
    <code>x-api-key</code> to actually exercise a request.
  </p>
</div>

<!-- Swagger UI ships its own light styling that doesn't follow this site's
     dark theme tokens, wrapped in a light card so it reads correctly
     regardless. -->
<div class="min-h-[60vh] overflow-auto rounded-2xl bg-white p-2">
  <div bind:this={container}></div>
</div>
