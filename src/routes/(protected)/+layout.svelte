<script lang="ts">
	import {
		BookOpen,
		CalendarClock,
		ChevronRight,
		CloudUpload,
		Container,
		Database,
		FolderKanban,
		GitBranch,
		HardDrive,
		LayoutDashboard,
		LayoutGrid,
		Menu,
		Network,
		ScrollText,
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
			href: resolve("/projects"),
			icon: FolderKanban,
			label: "Projects",
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

	// Custom accent color (see /profile/appearance) : overriding these three
	// CSS vars on this subtree's root cascades into every bg-accent/text-accent/
	// etc. Tailwind utility beneath it, since Tailwind v4's @theme block makes
	// them all reference var(--color-accent...) rather than a literal value.
	const accentStyle = $derived.by(() => {
		const hex = data.preferences.accentColor;
		if (!hex) {
			return "";
		}
		const r = Number.parseInt(hex.slice(1, 3), 16);
		const g = Number.parseInt(hex.slice(3, 5), 16);
		const b = Number.parseInt(hex.slice(5, 7), 16);
		return `--color-accent:${hex};--color-accent-light:rgba(${r},${g},${b},0.1);--color-accent-glow:rgba(${r},${g},${b},0.2);`;
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

	// Users/Settings/System Logs are instance-wide admin controls : hidden
	// from developers, who otherwise get the same dashboard (their own
	// services/projects, already isolated per-user).
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
    <p class="eyebrow mt-5 mb-1.5 flex items-center gap-1.5 px-3">
      <span class="size-1.5 rounded-full {color.dot}"></span>
      {group.heading}
    </p>
    {#each group.items as item (item.href)}
      {@const active = isActive(item.href, item.exact)}
      {@const NavIcon = item.icon}
      <a
        class="
          group/nav relative mb-0.5 flex items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2 text-[0.8125rem] transition-all duration-200
          {active
          ? `${color.activeBg} ${color.activeText} font-medium shadow-[inset_0_1px_0_0_var(--glass-highlight)]`
          : 'text-text-muted hover:bg-surface-2 hover:text-text'}
        "
        href={item.href}
        onclick={onNavigate}
      >
        {#if active}
          <span class="absolute inset-y-1.5 left-0 w-0.5 rounded-full {color.dot}"></span>
        {/if}
        <NavIcon class="size-4 shrink-0 transition-opacity {active ? '' : color.icon + ' opacity-60 group-hover/nav:opacity-100'}" />
        {item.label}
        {#if active}
          <ChevronRight class="ml-auto size-3.5 opacity-50" />
        {/if}
      </a>
    {/each}
  {/each}
{/snippet}

<!-- Fills the full viewport : there's no global navbar above this. -->
<div class="flex h-screen overflow-hidden" style={accentStyle}>
  <!-- ── Desktop sidebar ───────────────────────────────────────── -->
  <aside class="glass-strong hidden w-60 shrink-0 flex-col border-r md:flex">
    <!-- Nav links -->
    <nav class="flex-1 overflow-y-auto p-3 pt-4">
      <div class="mb-3 flex items-center gap-2 px-2 pt-1">
        <span class="bg-accent shadow-[0_0_10px_2px_var(--color-accent-glow)] size-2 rounded-full"></span>
        <span class="text-text font-mono text-[0.95rem] font-semibold tracking-tight">homerun</span>
      </div>
      {@render navGroups(mainNavGroups)}
      {@render navGroups(adminNavGroups)}
    </nav>
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
      class="glass-strong fixed top-0 left-0 z-50 flex h-screen w-72 flex-col border-r md:hidden"
      transition:fly={{ duration: 240, opacity: 1, x: -280 }}
    >
      <nav class="flex-1 overflow-y-auto p-3 pt-4">
        {@render navGroups(mainNavGroups, () => {
          sidebarOpen = false;
        })}
        {@render navGroups(adminNavGroups, () => {
          sidebarOpen = false;
        })}
      </nav>
    </div>
  {/if}

  <!-- ── Main content ───────────────────────────────────────────── -->
  <div class="flex flex-1 flex-col overflow-hidden">
    <!-- Sticky header, every page, both breakpoints : hamburger (mobile
         only) + page title on the left, notifications + account menu on
         the right. -->
    <header class="glass-strong sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b px-4 md:px-6">
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
      <span class="text-text flex-1 truncate font-mono text-sm font-medium tracking-tight">
        {$title || "Dashboard"}
      </span>
      <NotificationBell
        notifications={data.notifications}
        unreadCount={data.unreadCount}
      />
      <ProfileMenu user={data.user} />
    </header>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
</div>
