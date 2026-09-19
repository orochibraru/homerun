<script lang="ts">
	import {
		Activity,
		BookOpen,
		Boxes,
		CalendarClock,
		Clock,
		CloudUpload,
		Container,
		Database,
		FolderKanban,
		GitBranch,
		HardDrive,
		KeyRound,
		LayoutDashboard,
		LayoutGrid,
		Menu,
		Network,
		Plus,
		ScrollText,
		Send,
		Server,
		Settings,
		Trash2,
		Users,
		X,
	} from "@lucide/svelte";
	import { modeStorageKey, setMode } from "mode-watcher";
	import { onMount } from "svelte";
	import { fly } from "svelte/transition";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import AppVersion from "$lib/components/app-version.svelte";
	import BrandMark from "$lib/components/brand-mark.svelte";
	import ErrorBoundary from "$lib/components/error-boundary.svelte";
	import GlobalSearch from "$lib/components/global-search.svelte";
	import NotificationBell from "$lib/components/notification-bell.svelte";
	import ProfileMenu from "$lib/components/profile-menu.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

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

	// `category` groups the sidebar into labeled sections rather than one
	// flat list : order here is the render order, both for categories and
	// for items within one. Admin-only items keep their own separate
	// "Administration" section regardless of category (see below), same
	// "your stuff" vs. "instance administration" split as before.
	const allNavItems = [
		{
			adminOnly: false,
			category: "Workspace",
			exact: true,
			href: resolve("/"),
			icon: LayoutDashboard,
			label: "Overview",
		},
		{
			adminOnly: false,
			category: "Workspace",
			exact: false,
			href: resolve("/services"),
			icon: Server,
			label: "Services",
		},
		{
			adminOnly: false,
			category: "Workspace",
			exact: false,
			href: resolve("/stacks"),
			icon: FolderKanban,
			label: "Stacks",
		},
		{
			adminOnly: false,
			category: "Workspace",
			exact: false,
			href: resolve("/templates"),
			icon: LayoutGrid,
			label: "Templates",
		},
		{
			adminOnly: false,
			category: "Workspace",
			exact: false,
			href: resolve("/cron-jobs"),
			icon: Clock,
			label: "Cron Jobs",
		},
		{
			adminOnly: false,
			category: "Workspace",
			exact: false,
			href: resolve("/status-pages"),
			icon: Activity,
			label: "Status Page",
		},
		{
			adminOnly: false,
			category: "Infrastructure",
			exact: false,
			href: resolve("/storage"),
			icon: HardDrive,
			label: "Storage",
		},
		{
			adminOnly: false,
			category: "Infrastructure",
			exact: false,
			href: resolve("/backups"),
			icon: CloudUpload,
			label: "Backups",
		},
		{
			adminOnly: false,
			category: "Infrastructure",
			exact: false,
			href: resolve("/s3-destinations"),
			icon: Database,
			label: "S3 Destinations",
		},
		{
			adminOnly: false,
			category: "Infrastructure",
			exact: false,
			href: resolve("/remote-hosts"),
			icon: Network,
			label: "Remote Hosts",
		},
		{
			adminOnly: false,
			category: "Infrastructure",
			exact: false,
			href: resolve("/scheduling"),
			icon: CalendarClock,
			label: "Scheduling",
		},
		{
			adminOnly: false,
			category: "Integrations",
			exact: false,
			href: resolve("/git-providers"),
			icon: GitBranch,
			label: "Git Providers",
		},
		{
			adminOnly: false,
			category: "Integrations",
			exact: false,
			href: resolve("/build-cache-registries"),
			icon: Container,
			label: "Build Cache",
		},
		{
			adminOnly: false,
			category: "Integrations",
			exact: false,
			href: resolve("/notification-channels"),
			icon: Send,
			label: "Notification Channels",
		},
		{
			adminOnly: false,
			category: "Integrations",
			exact: false,
			href: resolve("/api-docs"),
			icon: BookOpen,
			label: "API Docs",
		},
		{
			adminOnly: true,
			category: "Administration",
			exact: false,
			href: resolve("/users"),
			icon: Users,
			label: "Users",
		},
		{
			adminOnly: true,
			category: "Administration",
			exact: false,
			href: resolve("/authentication"),
			icon: KeyRound,
			label: "Authentication",
		},
		{
			adminOnly: true,
			category: "Administration",
			exact: false,
			href: resolve("/settings"),
			icon: Settings,
			label: "Settings",
		},
		{
			adminOnly: true,
			category: "Administration",
			exact: false,
			href: resolve("/system-logs"),
			icon: ScrollText,
			label: "System Logs",
		},
		{
			adminOnly: true,
			category: "Administration",
			exact: false,
			href: resolve("/registry"),
			icon: Boxes,
			label: "Registry",
		},
		{
			adminOnly: true,
			category: "Administration",
			exact: false,
			href: resolve("/docker-cleanup"),
			icon: Trash2,
			label: "Docker Cleanup",
		},
	];

	interface NavGroup {
		heading: string;
		items: (typeof allNavItems)[number][];
	}

	// Color-codes each nav category (TODO.md's "color coding throughout the
	// UI so things are easier to visually locate") : a category is a visual
	// grouping, not just a text label, its icons/active-state pick up a
	// distinct accent instead of every item sharing the one generic
	// `accent` color. Literal Tailwind classes (not template-built) : JIT
	// needs the full class string present in source to include it.
	const categoryColors: Record<
		string,
		{ activeBg: string; activeText: string; dot: string; icon: string }
	> = {
		Administration: {
			activeBg: "bg-red-500/10",
			activeText: "text-red-600 dark:text-red-400",
			dot: "bg-red-500",
			icon: "text-red-500",
		},
		Infrastructure: {
			activeBg: "bg-emerald-500/10",
			activeText: "text-emerald-600 dark:text-emerald-400",
			dot: "bg-emerald-500",
			icon: "text-emerald-500",
		},
		Integrations: {
			activeBg: "bg-violet-500/10",
			activeText: "text-violet-600 dark:text-violet-400",
			dot: "bg-violet-500",
			icon: "text-violet-500",
		},
		Workspace: {
			activeBg: "bg-accent-light",
			activeText: "text-accent",
			dot: "bg-accent",
			icon: "text-accent",
		},
	};
	const fallbackColor = categoryColors.Workspace;
	// "Single accent color" mode (see /profile/appearance) : every category
	// collapses to this same shared-accent entry Workspace already used,
	// rather than each keeping its own distinct color.
	const colorful = $derived(
		data.preferences.sidebarColorIntensity === "colorful",
	);

	const accentCss = $derived.by(() => {
		const hex = data.preferences.accentColor ?? "";
		if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
			return "";
		}
		const r = Number.parseInt(hex.slice(1, 3), 16);
		const g = Number.parseInt(hex.slice(3, 5), 16);
		const b = Number.parseInt(hex.slice(5, 7), 16);
		return `:root:root{--color-accent:${hex};--color-ink:${hex};--primary:${hex};--color-accent-light:rgba(${r},${g},${b},0.12);--color-accent-glow:rgba(${r},${g},${b},0.35);--ring:rgba(${r},${g},${b},0.55);}`;
	});

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

	const mainNavGroups = $derived(
		groupByCategory(allNavItems.filter((item) => !item.adminOnly)),
	);
	const adminNavGroups = $derived(
		data.user?.role === "admin"
			? groupByCategory(allNavItems.filter((item) => item.adminOnly))
			: [],
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
    {@const color = colorful ? (categoryColors[group.heading] ?? fallbackColor) : fallbackColor}
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
          ? `border-sidebar-border bg-sidebar-accent ${color.activeText} font-medium`
          : 'text-text-muted hover:bg-surface-2 hover:text-text border-transparent'}
       "
        href={item.href}
        onclick={onNavigate}
      >
        <NavIcon class="size-4 shrink-0 {active ? '' : color.icon}" />
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
<div class="flex h-screen overflow-hidden p-2 md:gap-2">
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
      {@render navGroups(mainNavGroups)}
      {@render navGroups(adminNavGroups)}
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
      class="panel-strong fixed top-0 left-0 z-50 flex h-screen w-64 flex-col border-r border-border md:hidden"
      transition:fly={{ duration: 240, opacity: 1, x: -280 }}
    >
      <nav class="flex-1 overflow-y-auto px-2.5 pt-3 pb-4">
        {@render navGroups(mainNavGroups, () => {
          sidebarOpen = false;
        })}
        {@render navGroups(adminNavGroups, () => {
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
    <header class="border-border sticky top-0 z-30 flex h-12 shrink-0 items-center gap-2 border-b px-3 md:px-5">
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
      <span class="text-text flex-1 truncate text-sm font-medium">
        {$title || "Dashboard"}
      </span>
      {#if data.readOnly}
        <span
          class="text-text-muted border-border rounded-full border px-2 py-0.5 text-[0.7rem] font-medium"
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
    <main class="flex-1 overflow-y-auto">
      <ErrorBoundary class="p-5 md:p-6">
        {@render children()}
      </ErrorBoundary>
    </main>
  </div>
</div>
