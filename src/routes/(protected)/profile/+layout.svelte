<script lang="ts">
	import {
		KeyRound,
		Lock,
		Palette,
		ShieldCheck,
		UserCircle,
	} from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";

	const { children } = $props();

	interface RouteTab extends NavTab {
		exact: boolean;
		href: string;
	}

	const tabs: RouteTab[] = [
		{
			exact: true,
			href: resolve("/profile"),
			icon: UserCircle,
			id: "personal-information",
			label: "Personal Information",
		},
		{
			exact: false,
			href: resolve("/profile/security"),
			icon: Lock,
			id: "security",
			label: "Security",
		},
		{
			exact: false,
			href: resolve("/profile/sessions"),
			icon: ShieldCheck,
			id: "sessions",
			label: "Sessions",
		},
		{
			exact: false,
			href: resolve("/profile/clients"),
			icon: KeyRound,
			id: "clients",
			label: "Authorized Clients",
		},
		{
			exact: false,
			href: resolve("/profile/appearance"),
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

	const activeTabId = $derived(
		tabs.find((tab) => isActive(tab.href, tab.exact))?.id ?? "",
	);
</script>

<div class="p-6 md:p-8">
  <div class="mb-6">
    <h1 class="text-xl font-bold text-text">Settings</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      Manage your profile and account preferences.
    </p>
  </div>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <TabNav active={activeTabId} {tabs} />

  {@render children()}

  <!-- Extra bottom padding so the last card isn't flush with viewport edge -->
  <div class="h-4"></div>
</div>
