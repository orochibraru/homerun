<script lang="ts">
	import { KeyRound, LockKeyhole, UserRound } from "@lucide/svelte";
	import { onMount } from "svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children } = $props();

	const tabs: (NavTab & { href: string })[] = [
		{
			href: resolve("authentication"),
			icon: UserRound,
			id: "sign-in",
			label: "Sign-in",
		},
		{
			href: resolve("authentication/providers"),
			icon: KeyRound,
			id: "providers",
			label: "Providers",
		},
		{
			href: resolve("authentication/protected"),
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
        Who can sign in to Homerun, and which methods each protected app
        accepts.
      </p>
		</div>

		<TabNav active={activeTab.id} tabs={tabs}>
		  {@render children()}
		</TabNav>
	</div>
{:else}
  {@render children()}
{/if}
