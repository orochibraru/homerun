<script lang="ts">
	import {
		BookOpen,
		CalendarClock,
		ChevronRight,
		CloudUpload,
		FolderKanban,
		GitBranch,
		HardDrive,
		LayoutDashboard,
		LayoutGrid,
		LogOut,
		Menu,
		Network,
		ScrollText,
		Server,
		Settings,
		Users,
		X,
	} from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { toast } from "svelte-sonner";
	import { goto, invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { signOut } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button/index.js";

	const { data, children } = $props();

	let sidebarOpen = $state(false);

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
	];

	interface NavGroup {
		heading: string;
		items: (typeof allNavItems)[number][];
	}

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

	const userInitial = $derived(data.user?.name?.[0]?.toUpperCase() ?? "?");

	function isActive(href: string, exact: boolean): boolean {
		if (exact) {
			return page.url.pathname === href;
		}
		return page.url.pathname.startsWith(href);
	}

	/** Derive a human-readable title from the current pathname for mobile */
	const mobileTitle = $derived.by(() => {
		const p = page.url.pathname;
		if (p.includes("/profile")) {
			return "Profile";
		}
		if (p.includes("/services")) {
			return "Services";
		}
		return "Dashboard";
	});

	async function signOutCallback() {
		sidebarOpen = false;
		await signOut();
		await invalidateAll();
	}

	function handleSignOut() {
		return toast.promise(signOutCallback, {
			error: (e) => (e instanceof Error ? e.message : "Failed to sign you out"),
			loading: "Signing you out",
			success: "Signed you out successfully",
		});
	}
</script>

{#snippet navGroups(groups: NavGroup[], onNavigate?: () => void)}
  {#each groups as group (group.heading)}
    <p class="text-text-muted mt-4 mb-2 px-3 text-[0.65rem] font-semibold tracking-widest uppercase">
      {group.heading}
    </p>
    {#each group.items as item (item.href)}
      {@const active = isActive(item.href, item.exact)}
      {@const NavIcon = item.icon}
      <a
        class="
          mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200
          {active
          ? 'bg-accent-light text-accent'
          : 'text-text-muted hover:bg-surface-2 hover:text-text'}
        "
        href={item.href}
        onclick={onNavigate}
      >
        <NavIcon class="size-4 shrink-0" />
        {item.label}
        {#if active}
          <ChevronRight class="ml-auto size-3.5 opacity-60" />
        {/if}
      </a>
    {/each}
  {/each}
{/snippet}

<!-- Fills the full viewport : there's no global navbar above this. -->
<div class="bg-bg flex h-screen overflow-hidden">
  <!-- ── Desktop sidebar ───────────────────────────────────────── -->
  <aside class="border-border bg-surface hidden w-60 shrink-0 flex-col border-r md:flex">
    <!-- Nav links -->
    <nav class="flex-1 overflow-y-auto p-3 pt-4">
      <p class="mb-2 px-2 text-xl font-bold">Homerun</p>
      {@render navGroups(mainNavGroups)}
      {@render navGroups(adminNavGroups)}
    </nav>

    <!-- User section -->
    <div class="border-border border-t p-3">
      <a
        class="hover:bg-muted flex items-center gap-3 rounded-xl p-2 transition-colors"
        href={resolve("/profile")}
      >
        {#if data.user?.image}
          <img
            alt={data.user.name}
            class="ring-border size-8 rounded-full object-cover ring-1"
            src={data.user.image}
          >
        {:else}
          <div class="bg-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white">
            {userInitial}
          </div>
        {/if}
        <div class="min-w-0 flex-1">
          <p class="text-text truncate text-xs font-semibold">
            {data.user?.name}
          </p>
          <p class="text-text-muted truncate text-[0.7rem]">
            {data.user?.email}
          </p>
        </div>
      </a>
      <Button
        class="mt-1 w-full justify-start gap-2.5 text-xs text-red-500 hover:bg-red-500/10 hover:text-red-500"
        onclick={handleSignOut}
        variant="ghost"
      >
        <LogOut class="size-3.5" />
        Sign out
      </Button>
    </div>
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
      class="border-border bg-surface fixed top-0 left-0 z-50 flex h-screen w-72 flex-col border-r shadow-2xl md:hidden"
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

      <div class="border-border border-t p-3">
        <div class="flex items-center gap-3 rounded-xl p-2">
          {#if data.user?.image}
            <img
              alt={data.user.name}
              class="size-8 rounded-full object-cover"
              src={data.user.image}
            >
          {:else}
            <div class="bg-accent flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white">
              {userInitial}
            </div>
          {/if}
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-xs font-semibold">
              {data.user?.name}
            </p>
            <p class="text-text-muted truncate text-[0.7rem]">
              {data.user?.email}
            </p>
          </div>
        </div>
        <button
          class="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-red-500 transition-all duration-200 hover:bg-red-500/10"
          onclick={handleSignOut}
          type="button"
        >
          <LogOut class="size-3.5" />
          Sign out
        </button>
      </div>
    </div>
  {/if}

  <!-- ── Main content ───────────────────────────────────────────── -->
  <div class="flex flex-1 flex-col overflow-hidden">
    <!-- Mobile-only bar: hamburger + page title -->
    <div class="border-border bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-4 md:hidden">
      <Button
        aria-label="Toggle sidebar"
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
      <span class="text-text text-sm font-medium">
        {mobileTitle}
      </span>
    </div>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
</div>
