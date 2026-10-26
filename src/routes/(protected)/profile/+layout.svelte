<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import {
		AppWindow,
		KeyRound,
		Lock,
		LogOut,
		Palette,
		ShieldCheck,
		UserCircle,
	} from "@lucide/svelte";

	import { handleSignOut } from "#lib/account-actions.js";
	import MobileAccountPanel from "#lib/components/mobile-account-panel.svelte";
	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";

	const { children, data } = $props();

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs: RouteTab[] = [
		{
			exact: true,
			href: resolve("profile"),
			icon: UserCircle,
			id: "personal-information",
			label: "Personal Information",
		},
		{
			exact: false,
			href: resolve("profile/security"),
			icon: Lock,
			id: "security",
			label: "Security",
		},
		{
			exact: false,
			href: resolve("profile/sessions"),
			icon: ShieldCheck,
			id: "sessions",
			label: "Sessions",
		},
		{
			exact: false,
			href: resolve("profile/api-keys"),
			icon: KeyRound,
			id: "api-keys",
			label: "API Keys",
		},
		{
			exact: false,
			href: resolve("profile/clients"),
			icon: AppWindow,
			id: "clients",
			label: "Authorized Clients",
		},
		{
			exact: false,
			href: resolve("profile/appearance"),
			icon: Palette,
			id: "appearance",
			label: "Appearance",
		},
	];

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	const atHub = $derived(
		page.url.pathname === resolve("profile") && page.url.search === "",
	);

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
	<div class="mb-6 max-md:hidden">
		<h1 class="text-text text-lg font-semibold tracking-tight">Settings</h1>
		<p class="mt-0.5 text-sm text-text-muted">
			Manage your profile and account preferences.
		</p>
	</div>

	{#if atHub && data.user}
		<MobileAccountPanel
			theme={data.preferences.theme}
			uiMode={data.uiMode}
			user={data.user}
		/>
	{/if}

	<!-- ── Tabs ─────────────────────────────────────────────── -->
	<TabNav active={activeTabId} {tabs}>
		{@render children()}
	</TabNav>

	{#if atHub}
		<button
			class="border-border bg-surface text-destructive mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold md:hidden"
			onclick={handleSignOut}
			type="button"
		>
			<LogOut class="size-4" />
			Sign out
		</button>
	{/if}

	<!-- Extra bottom padding so the last card isn't flush with viewport edge -->
	<div class="h-4"></div>
</div>
