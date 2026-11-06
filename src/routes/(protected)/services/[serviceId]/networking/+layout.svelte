<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Globe, Network, Plug, Zap } from "@lucide/svelte";

	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import SectionNav from "#lib/components/section-nav.svelte";
	import { visibleItems } from "#lib/ui-mode.js";

	const { children, data } = $props();

	const svc = $derived(data.service);

	const sections = $derived([
		{
			href: resolve("/(protected)/services/[serviceId]/networking", {
				serviceId: svc.id,
			}),
			icon: Globe,
			id: "service/networking/domains",
			inUse: true,
			label: "Domains",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/networking/network", {
				serviceId: svc.id,
			}),
			icon: Network,
			id: "service/networking/network",
			inUse: true,
			label: "Network",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/networking/ports", {
				serviceId: svc.id,
			}),
			icon: Plug,
			id: "service/networking/ports",
			inUse: svc.publishedPorts.length > 0 || svc.exposedPorts.length > 0,
			label: "Ports",
		},
		{
			href: resolve("/(protected)/services/[serviceId]/networking/cache", {
				serviceId: svc.id,
			}),
			icon: Zap,
			id: "service/networking/cache",
			inUse: svc.httpCacheTtl !== null,
			label: "Cache",
		},
	]);

	const shown = $derived.by(() => {
		const visible = visibleItems(data.uiMode, sections, page.url.pathname);
		return sections.filter(
			(section) => section.inUse || visible.includes(section),
		);
	});
</script>

{#if shown.length > 1}
	<SectionNav
		hubLabel="Networking"
		label="Networking sections"
		sections={shown}
	>
		{@render children()}
	</SectionNav>
{:else}
	<ErrorBoundary title="This section hit an error while rendering.">
		{@render children()}
	</ErrorBoundary>
{/if}
