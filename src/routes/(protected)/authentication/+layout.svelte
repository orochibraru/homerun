<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { KeyRound, LockKeyhole, UserRound } from "@lucide/svelte";
	import { onMount } from "svelte";

	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { title } from "#lib/store/title.js";

	const { children } = $props();

	const tabs: (NavTab & { href: string })[] = [
		{
			href: resolve("authentication"),
			icon: UserRound,
			description: "Email sign-in, preferred methods and sign-in requirements",
			id: "sign-in",
			label: "Sign-in",
		},
		{
			href: resolve("authentication/providers"),
			icon: KeyRound,
			description: "OAuth and OIDC providers for single sign-on",
			id: "providers",
			label: "Providers",
		},
		{
			href: resolve("authentication/protected"),
			icon: LockKeyhole,
			description: "Services behind the login wall, and who gets in",
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
			<h1 class="text-text text-lg font-semibold tracking-tight max-md:hidden">
				Authentication
			</h1>
			<p class="text-text-muted mt-1 text-sm">
				Who can sign in to Homerun, and which methods each protected app
				accepts.
			</p>
		</div>

		<TabNav active={activeTab.id} {tabs}>
			{@render children()}
		</TabNav>
	</div>
{:else}
	{@render children()}
{/if}
