<script lang="ts">
	import { AppWindow, KeyRound, LockKeyhole, UserRound } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { title } from "$lib/store/title";

	const { children } = $props();

	const tabs: (NavTab & { href: string })[] = [
		{
			href: resolve("/authentication"),
			icon: UserRound,
			id: "sign-in",
			label: "Sign-in",
		},
		{
			href: resolve("/authentication/providers"),
			icon: KeyRound,
			id: "providers",
			label: "Providers",
		},
		{
			href: resolve("/authentication/apps"),
			icon: AppWindow,
			id: "apps",
			label: "Sign in with Homerun",
		},
		{
			href: resolve("/authentication/protected"),
			icon: LockKeyhole,
			id: "protected",
			label: "Protected apps",
		},
	];

	const activeTab = $derived(
		tabs.find((tab) => tab.href === page.url.pathname),
	);

	onMount(() => title.set("Authentication"));
</script>

{#if activeTab}
  <div class="p-5 md:p-6">
    <div class="mb-8">
      <h1 class="text-text text-lg font-semibold tracking-tight">
        Authentication
      </h1>
      <p class="text-text-muted mt-1 text-sm">
        Who can sign in to Homerun, the apps that sign in with it, and which
        methods each protected app accepts.
      </p>
    </div>

    <TabNav active={activeTab.id} {tabs} />

    {@render children()}
  </div>
{:else}
  {@render children()}
{/if}
