<script lang="ts">
  import {
    ChevronRight,
    FolderKanban,
    HardDrive,
    LayoutDashboard,
    LayoutGrid,
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
      exact: true,
      href: resolve("/"),
      icon: LayoutDashboard,
      label: "Overview",
    },
    {
      exact: false,
      href: resolve("/services"),
      icon: Server,
      label: "Services",
    },
    {
      exact: false,
      href: resolve("/projects"),
      icon: FolderKanban,
      label: "Projects",
    },
    {
      exact: false,
      href: resolve("/templates"),
      icon: LayoutGrid,
      label: "Templates",
    },
    {
      exact: false,
      href: resolve("/storage"),
      icon: HardDrive,
      label: "Storage",
    },
  ];

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

  async function handleSignOut() {
    sidebarOpen = false;
    await signOut();
    goto(resolve("/"));
  }
</script>

<!-- Fills the full viewport — there's no global navbar above this. -->
<div class="bg-bg flex h-screen overflow-hidden">
  <!-- ── Desktop sidebar ───────────────────────────────────────── -->
  <aside
    class="border-border bg-surface hidden w-60 shrink-0 flex-col border-r md:flex"
  >
    <!-- Nav links -->
    <nav class="flex-1 overflow-y-auto p-3 pt-4">
      <p class="font-bold text-xl px-2">Homerun</p>
      <p
        class="text-text-muted mb-2 px-3 text-[0.65rem] font-semibold tracking-widest uppercase"
      >
        Navigation
      </p>
      {#each navItems as item}
        {@const active = isActive(item.href, item.exact)}
        {@const NavIcon = item.icon}
        <a
          class="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200
						{active
            ? 'bg-accent-light text-accent'
            : 'text-text-muted hover:bg-surface-2 hover:text-text'}"
          href={item.href}
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
      <a
        class="flex items-center gap-3 rounded-xl p-2 hover:bg-muted transition-colors"
        href={resolve("/profile")}
      >
        {#if data.user?.image}
          <img
            alt={data.user.name}
            class="ring-border size-8 rounded-full object-cover ring-1"
            src={data.user.image}
          >
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
      </a>
      <button
        class="mt-1 flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-xs font-medium text-red-500 transition-all duration-200 hover:bg-red-500/10"
        onclick={handleSignOut}
        type="button"
      >
        <LogOut class="size-3.5" />
        Sign out
      </button>
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
    ></button>

    <div
      class="border-border bg-surface fixed top-0 left-0 z-50 flex h-screen w-72 flex-col border-r shadow-2xl md:hidden"
      transition:fly={{ duration: 240, opacity: 1, x: -280 }}
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
            class="mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200
							{active
              ? 'bg-accent-light text-accent'
              : 'text-text-muted hover:bg-surface-2 hover:text-text'}"
            href={item.href}
            onclick={() => {
              sidebarOpen = false;
            }}
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
              alt={data.user.name}
              class="size-8 rounded-full object-cover"
              src={data.user.image}
            >
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
    <div
      class="border-border bg-surface flex h-12 shrink-0 items-center gap-3 border-b px-4 md:hidden"
    >
      <button
        aria-label="Toggle sidebar"
        class="text-text-muted hover:bg-surface-2 hover:text-text rounded-lg p-1.5 transition-all"
        onclick={() => {
          sidebarOpen = !sidebarOpen;
        }}
        type="button"
      >
        {#if sidebarOpen}
          <X class="size-5" />
        {:else}
          <Menu class="size-5" />
        {/if}
      </button>
      <span class="text-sm font-medium text-text">
        {mobileTitle}
      </span>
    </div>

    <!-- Page content -->
    <main class="flex-1 overflow-y-auto">
      {@render children()}
    </main>
  </div>
</div>
