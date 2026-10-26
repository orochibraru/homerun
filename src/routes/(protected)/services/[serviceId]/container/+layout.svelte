<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Cpu, TerminalSquare } from "@lucide/svelte";

	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { visibleItems } from "#lib/ui-mode.js";

	const { children, data } = $props();

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/container", {
				serviceId: data.service.id,
			}),
			icon: Cpu,
			id: "service/container/compute",
			label: "Compute",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/container/runtime", {
				serviceId: data.service.id,
			}),
			icon: TerminalSquare,
			id: "service/container/runtime",
			label: "Runtime",
		},
	]);

	const shown = $derived(
		visibleItems(data.uiMode, sections, page.url.pathname),
	);
</script>

{#if shown.length > 1}
	<SectionNav hubLabel="Container" label="Container sections" sections={shown}>
		{@render children()}
	</SectionNav>
{:else}
	<ErrorBoundary title="This section hit an error while rendering.">
		{@render children()}
	</ErrorBoundary>
{/if}
