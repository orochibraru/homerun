<script lang="ts">
	import {
		ChevronRight,
		LayoutDashboard,
		LogOut,
		Menu,
		Server,
		Settings,
		X,
	} from "@lucide/svelte";
	import { fly } from "svelte/transition";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { signOut } from "$lib/auth-client";

	const { data, children } = $props();

	let sidebarOpen = $state(false);

	const navItems = [
		{
			href: resolve("/"),
			label: "Overview",
			icon: LayoutDashboard,
			exact: true,
		},
		{
			href: resolve("/services"),
			label: "Services",
			icon: Server,
			exact: false,
		},
		{
			href: resolve("/settings"),
			label: "Settings",
			icon: Settings,
			exact: false,
		},
	];

	const userInitial = $derived(data.user?.name?.[0]?.toUpperCase() ?? "?");

	function isActive(href: string, exact: boolean): boolean {
		if (exact) return page.url.pathname === href;
		return page.url.pathname.startsWith(href);
	}

	/** Derive a human-readable title from the current pathname for mobile */
	const mobileTitle = $derived.by(() => {
		const p = page.url.pathname;
		if (p.includes("/settings")) return "Settings";
		if (p.includes("/services")) return "Services";
		return "Dashboard";
	});

	async function handleSignOut() {
		sidebarOpen = false;
		await signOut();
		goto(resolve("/"));
	}
</script>

<!-- Fills the viewport below the fixed global navbar (h-16 = 4 rem) -->
<div class="bg-bg flex h-screen overflow-hidden">
  <!-- ── Desktop sidebar ───────────────────────────────────────── -->
  <aside
    class="border-border bg-surface hidden w-60 shrink-0 flex-col border-r md:flex"
  >
    <!-- Nav links -->
    <nav class="flex-1 overflow-y-auto p-3 pt-4">
      <p
        class="text-text-muted mb-2 px-3 text-[0.65rem] font-semibold tracking-widest uppercase"
      >
        Navigation
      </p>
      {#each navItems as item}
        {@const active = isActive(item.href, item.exact)}
        {@const NavIcon = item.icon}
        <a
          href={item.href}
          class="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200
						{active
            ? 'bg-accent-light text-accent'
            : 'text-text-muted hover:bg-surface-2 hover:text-text'}"
        >
          <NavIcon class="size-4 shrink-0" />
          {item.label}
          {#if active}
            <ChevronRight class="ml-auto size-3.5 opacity-60" />
          {/if}
        </a>
      {/each}
    </nav>

    <!-- User section -->
    <div class="border-border border-t p-3">
      <div class="flex items-center gap-3 rounded-xl p-2">
        {#if data.user?.image}
          <img
            src={data.user.image}
            alt={data.user.name}
            class="ring-border size-8 rounded-full object-cover ring-1"
          />
        {:else}
          <div
            class="bg-accent flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white"
          >
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
        onclick={handleSignOut}
        class="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-red-500 transition-all duration-200 hover:bg-red-500/10"
      >
        <LogOut class="size-3.5" />
        Sign out
      </button>
    </div>
  </aside>

  <!-- ── Mobile sidebar overlay ────────────────────────────────── -->
  {#if sidebarOpen}
    <button
      class="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm md:hidden"
      onclick={() => (sidebarOpen = false)}
      aria-label="Close sidebar"
    ></button>

    <div
      transition:fly={{ x: -280, duration: 240, opacity: 1 }}
      class="border-border bg-surface fixed top-16 left-0 z-50 flex h-[calc(100vh-4rem)] w-72 flex-col border-r shadow-2xl md:hidden"
    >
      <nav class="flex-1 overflow-y-auto p-3 pt-4">
        <p
          class="text-text-muted mb-2 px-3 text-[0.65rem] font-semibold tracking-widest uppercase"
        >
          Navigation
        </p>
        {#each navItems as item}
          {@const active = isActive(item.href, item.exact)}
          {@const MobileNavIcon = item.icon}
          <a
            href={item.href}
            onclick={() => (sidebarOpen = false)}
            class="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200
							{active
              ? 'bg-accent-light text-accent'
              : 'text-text-muted hover:bg-surface-2 hover:text-text'}"
          >
            <MobileNavIcon class="size-4 shrink-0" />
            {item.label}
          </a>
        {/each}
      </nav>

      <div class="border-border border-t p-3">
        <div class="flex items-center gap-3 rounded-xl p-2">
          {#if data.user?.image}
            <img
              src={data.user.image}
              alt={data.user.name}
              class="size-8 rounded-full object-cover"
            />
          {:else}
            <div
              class="bg-accent flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white"
            >
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
          onclick={handleSignOut}
          class="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-red-500 transition-all duration-200 hover:bg-red-500/10"
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
    <div
      class="border-border bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-4 md:hidden"
    >
      <button
        onclick={() => (sidebarOpen = !sidebarOpen)}
        class="text-text-muted hover:bg-surface-2 hover:text-text rounded-lg p-1.5 transition-all"
        aria-label="Toggle sidebar"
      >
        {#if sidebarOpen}
          <X class="size-5" />
        {:else}
          <Menu class="size-5" />
        {/if}
      </button>
      <span class="text-sm font-medium text-[var(--color-text)]">
        {mobileTitle}
      </span>
    </div>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
</div>
