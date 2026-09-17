<script lang="ts">
	import { Boxes, KeyRound, Settings2, Ticket } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { title } from "$lib/store/title";

	const { children } = $props();

	onMount(() => {
		title.set("Registry");
	});

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs: RouteTab[] = [
		{
			exact: true,
			href: resolve("/(protected)/registry"),
			icon: Boxes,
			id: "images",
			label: "Images",
		},
		{
			exact: false,
			href: resolve("/(protected)/registry/tokens"),
			icon: Ticket,
			id: "tokens",
			label: "Tokens",
		},
		{
			exact: false,
			href: resolve("/(protected)/registry/credentials"),
			icon: KeyRound,
			id: "credentials",
			label: "Credentials",
		},
		{
			exact: false,
			href: resolve("/(protected)/registry/settings"),
			icon: Settings2,
			id: "settings",
			label: "Settings",
		},
	];

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
  <header class="mb-6">
    <h1 class="text-text text-2xl font-semibold">Registry</h1>
    <p class="text-text-muted mt-1 text-sm">
      The built-in image registry. Homerun mirrors every image it scans through
      it, and it can double as a private registry you push to.
    </p>
  </header>

  <TabNav active={activeTabId} {tabs} />

  {@render children()}
</div>
