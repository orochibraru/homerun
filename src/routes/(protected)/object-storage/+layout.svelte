<script lang="ts">
	import { Database, HardDrive, Plug } from "@lucide/svelte";
	import { onMount } from "svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children } = $props();

	onMount(() => {
		title.set("Object Storage");
	});

	interface RouteTab extends NavTab {
		href: string;
	}

	const tabs: RouteTab[] = [
		{
			href: resolve("/(protected)/object-storage"),
			icon: Database,
			id: "buckets",
			label: "Buckets",
		},
		{
			href: resolve("/(protected)/object-storage/stores"),
			icon: Plug,
			id: "stores",
			label: "Stores",
		},
		{
			href: resolve("/(protected)/object-storage/built-in"),
			icon: HardDrive,
			id: "built-in",
			label: "Built-in",
		},
	];

	const activeTabId = $derived(
		tabs.find((tab) =>
			tab.id === "buckets"
				? page.url.pathname === tab.href ||
					/\/object-storage\/[^/]+\/buckets\//.test(page.url.pathname)
				: page.url.pathname.startsWith(tab.href),
		)?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
  <header class="mb-6">
    <h1 class="text-text text-2xl font-semibold">Object Storage</h1>
    <p class="text-text-muted mt-1 text-sm">
      S3 buckets on the built-in store and on any S3-compatible provider you
      connect.
    </p>
  </header>

  <TabNav active={activeTabId} {tabs}>
    {@render children()}
  </TabNav>
</div>
