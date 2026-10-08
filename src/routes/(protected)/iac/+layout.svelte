<script lang="ts">
	import {
		Database,
		FileCode2,
		GitCompareArrows,
		KeyRound,
		LayoutDashboard,
		Package,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children } = $props();

	onMount(() => {
		title.set("Infrastructure as Code");
	});

	interface RouteTab extends NavTab {
		href: string;
	}

	const tabs: RouteTab[] = [
		{
			href: resolve("/(protected)/iac"),
			icon: LayoutDashboard,
			id: "overview",
			label: "Overview",
		},
		{
			href: resolve("/(protected)/iac/generate"),
			icon: FileCode2,
			id: "generate",
			label: "Generate",
		},
		{
			href: resolve("/(protected)/iac/state"),
			icon: Database,
			id: "state",
			label: "State",
		},
		{
			href: resolve("/(protected)/iac/credentials"),
			icon: KeyRound,
			id: "credentials",
			label: "Credentials",
		},
		{
			href: resolve("/(protected)/iac/drift"),
			icon: GitCompareArrows,
			id: "drift",
			label: "Drift",
		},
		{
			href: resolve("/(protected)/iac/provider"),
			icon: Package,
			id: "provider",
			label: "Provider",
		},
	];

	const activeTabId = $derived(
		tabs.find((tab) =>
			tab.id === "overview"
				? page.url.pathname === tab.href
				: page.url.pathname.startsWith(tab.href),
		)?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
  <header class="mb-6">
    <h1 class="text-text text-2xl font-semibold">Infrastructure as Code</h1>
    <p class="text-text-muted mt-1 text-sm">
      Manage this instance with Terraform or Pulumi: generate a configuration
      from what's running, keep its state here, and see where a state and the
      instance disagree.
    </p>
  </header>

  <TabNav active={activeTabId} {tabs}>
    {@render children()}
  </TabNav>
</div>
