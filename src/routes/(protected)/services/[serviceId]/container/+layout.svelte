<script lang="ts">
	import { Cpu, TerminalSquare } from "@lucide/svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { visibleItems } from "#lib/ui-mode.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

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
  <SectionNav label="Container sections" sections={shown} />
{/if}

{@render children()}
