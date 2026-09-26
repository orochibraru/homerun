<script lang="ts">
	import { Menu, Plus, X } from "@lucide/svelte";
	import { modeStorageKey, setMode } from "mode-watcher";
	import { onMount } from "svelte";
	import { fly } from "svelte/transition";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import AppVersion from "$lib/components/app-version.svelte";
	import BrandMark from "$lib/components/brand-mark.svelte";
	import Breadcrumbs from "$lib/components/breadcrumbs.svelte";
	import ErrorBoundary from "$lib/components/error-boundary.svelte";
	import GlobalSearch from "$lib/components/global-search.svelte";
	import NotificationBell from "$lib/components/notification-bell.svelte";
	import ProfileMenu from "$lib/components/profile-menu.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { appearanceCss } from "$lib/palettes";
	import { allNavItems } from "./nav-items";

	const { data, children } = $props();

	let sidebarOpen = $state(false);

	// Seeds a browser that's never set a device-local theme override (no
	// mode-watcher localStorage entry yet, e.g. a first visit on a new
	// device) from the account's own saved preference, so signing in
	// somewhere new picks up the theme chosen on /profile/appearance instead
	// of defaulting to "system". A browser that already has its own
	// mode-watcher entry (set by a past visit here, or by that page itself)
	// is left alone : mode-watcher's own localStorage persistence owns it
	// from that point on.
	onMount(() => {
		if (
			data.preferences.theme !== "system" &&
			!localStorage.getItem(modeStorageKey.current)
		) {
			setMode(data.preferences.theme);
		}
	});

	interface NavGroup {
		heading: string;
		items: (typeof allNavItems)[number][];
	}

	const accentCss = $derived(appearanceCss(data.preferences));

	/** Groups a flat item list into category-labeled sections, preserving first-seen category order. */
	function groupByCategory(items: typeof allNavItems): NavGroup[] {
		const groups: NavGroup[] = [];
		for (const item of items) {
			let group = groups.find((g) => g.heading === item.category);
			if (!group) {
				group = { heading: item.category, items: [] };
				groups.push(group);
			}
			group.items.push(item);
		}
		return groups;
	}

	const navItemGroups = $derived(
		groupByCategory(
			allNavItems.filter(
				(item) => !item.adminOnly || data.user?.role === "admin",
			),
		),
	);

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}
</script>

{#snippet navGroups(groups: NavGroup[], onNavigate?: () => void)}
  {#each groups as group (group.heading)}
    <p class="text-text-subtle mt-5 mb-1.5 px-2.5 text-xs font-medium">
      {group.heading}
    </p>
    {#each group.items as item (item.href)}
      {@const active = isActive(item.href, item.exact)}
      {@const NavIcon = item.icon}
      <a
        class="
          group/nav relative mb-0.5 flex items-center gap-2.5 rounded-lg border px-2.5 py-1.5 text-[0.8125rem] transition-colors duration-150
          {active
          ? 'border-sidebar-border bg-sidebar-accent text-accent font-semibold'
          : 'text-text-muted hover:bg-surface-2 hover:text-text border-transparent font-medium'}
       "
        href={item.href}
        onclick={onNavigate}
      >
        <NavIcon class="text-accent size-4 shrink-0" />
        {item.label}
      </a>
    {/each}
  {/each}
{/snippet}

<svelte:head>
  {#if accentCss}
    {@html `<style>${accentCss}</style>`}
  {/if}
</svelte:head>

<!-- Fills the full viewport : there's no global navbar above this. -->
<div class="flex h-dvh overflow-hidden p-2 md:gap-2">
  <!-- ── Desktop sidebar ───────────────────────────────────────── -->
  <aside class="hidden w-56 shrink-0 flex-col md:flex">
    <BrandMark class="px-3 py-2.5" />

    {#if !data.readOnly}
      <div class="px-2 pb-2">
        <Button class="w-full" href={resolve("/services/new")}>
          <Plus class="size-4" />
          Deploy a service
        </Button>
      </div>
    {/if}

    <!-- Nav links -->
    <nav class="flex-1 overflow-y-auto px-2 pb-3">
      {@render navGroups(navItemGroups)}
    </nav>
    <AppVersion admin={data.user?.role === "admin"} />
  </aside>

  <!-- ── Mobile sidebar overlay ────────────────────────────────── -->
  {#if sidebarOpen}
    <button
      aria-label="Close sidebar"
      class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
      onclick={() => {
        sidebarOpen = false;
      }}
      type="button"
    >
    </button>

    <div
      class="panel-strong fixed top-0 left-0 z-50 flex h-dvh w-64 flex-col border-r border-border md:hidden"
      transition:fly={{ duration: 240, opacity: 1, x: -280 }}
    >
      <nav class="flex-1 overflow-y-auto px-2.5 pt-3 pb-4">
        {@render navGroups(navItemGroups, () => {
          sidebarOpen = false;
        })}
      </nav>
      <AppVersion admin={data.user?.role === "admin"} />
    </div>
  {/if}

  <!-- ── Main content ───────────────────────────────────────────── -->
  <div class="panel flex flex-1 flex-col overflow-hidden rounded-xl">
    <!-- Sticky header, every page, both breakpoints : hamburger (mobile
         only) + page title on the left, notifications + account menu on
         the right. -->
    <header class="border-border sticky top-0 z-30 flex h-12 shrink-0 items-center gap-1.5 border-b px-2 sm:gap-2 sm:px-3 md:px-5">
      <Button
        aria-label="Toggle sidebar"
        class="md:hidden"
        onclick={() => {
          sidebarOpen = !sidebarOpen;
        }}
        size="icon-sm"
        variant="ghost"
      >
        {#if sidebarOpen}
          <X class="size-5" />
        {:else}
          <Menu class="size-5" />
        {/if}
      </Button>
      <Breadcrumbs roots={allNavItems} />
      {#if data.readOnly}
        <span
          class="text-text-muted border-border hidden rounded-full border px-2 py-0.5 text-[0.7rem] font-medium sm:inline"
          title="This account or API key can view everything but can't change anything."
        >
          Read-only
        </span>
      {/if}
      <GlobalSearch isAdmin={data.user?.role === "admin"} />
      <NotificationBell />
      <ProfileMenu user={data.user} />
    </header>

    <!-- Page content -->
    <main class="relative flex-1 overflow-y-auto">
      <ErrorBoundary class="p-5 md:p-6">
        {@render children()}
      </ErrorBoundary>
    </main>
  </div>
</div>
