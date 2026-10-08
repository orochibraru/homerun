<script lang="ts">
	import { Globe, KeyRound, Waypoints } from "@lucide/svelte";
	import { onMount } from "svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children } = $props();

	onMount(() => title.set("DNS"));

	const tabs = $derived<(NavTab & { href: string })[]>([
		{
			href: resolve("dns"),
			icon: Globe,
			id: "domains",
			label: "Domains",
		},

		{
			href: resolve("dns/providers"),
			icon: KeyRound,
			id: "providers",
			label: "Providers",
		},
		{
			href: resolve("dns/pangolin"),
			icon: Waypoints,
			id: "pangolin",
			label: "Pangolin",
		},
	]);

	const activeTabId = $derived(
		page.url.pathname.startsWith(resolve("dns/providers"))
			? "providers"
			: page.url.pathname.startsWith(resolve("dns/pangolin"))
				? "pangolin"
				: "domains",
	);
</script>

<div class="p-5 md:p-6">
	<div class="mb-6">
    <h1 class="text-text text-lg font-semibold tracking-tight">DNS</h1>
		<p class="text-text-muted mt-1 text-sm">
      Your domains and the DNS providers they live at. A service's hostname
      under a managed domain gets its record created and removed with it.
		</p>
	</div>

	<TabNav active={activeTabId} tabs={tabs}>
	  {@render children()}
	</TabNav>
</div>
