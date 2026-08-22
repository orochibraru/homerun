<script lang="ts">
	import { KeyRound, Lock, ShieldCheck, UserCircle } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";

	const { children } = $props();

	const tabs = [
		{
			exact: true,
			href: resolve("/profile"),
			icon: UserCircle,
			label: "Personal Information",
		},
		{
			exact: false,
			href: resolve("/profile/security"),
			icon: Lock,
			label: "Security",
		},
		{
			exact: false,
			href: resolve("/profile/sessions"),
			icon: ShieldCheck,
			label: "Sessions",
		},
		{
			exact: false,
			href: resolve("/profile/clients"),
			icon: KeyRound,
			label: "Authorized Clients",
		},
	];

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-6">
    <h1 class="text-xl font-bold text-text">Settings</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      Manage your profile and account preferences.
    </p>
  </div>

  <!-- ── Tabs ─────────────────────────────────────────────── -->
  <div class="mb-6 flex gap-1 overflow-x-auto border-b border-border">
    {#each tabs as tab (tab.href)}
      {@const active = isActive(tab.href, tab.exact)}
      {@const TabIcon = tab.icon}
      <a
        class="
          flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-all duration-200
          {active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text'}
        "
        href={tab.href}
      >
        <TabIcon class="size-4" />
        {tab.label}
      </a>
    {/each}
  </div>

  {@render children()}

  <!-- Extra bottom padding so the last card isn't flush with viewport edge -->
  <div class="h-4"></div>
</div>
