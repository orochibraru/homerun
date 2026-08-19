<script lang="ts">
	import {
		Car,
		ChevronRight,
		LayoutDashboard,
		LogOut,
		Menu,
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
			href: resolve("/dashboard"),
			label: "Overview",
			icon: LayoutDashboard,
			exact: true,
		},
		{
			href: resolve("/dashboard/cars"),
			label: "My Garage",
			icon: Car,
			exact: false,
		},
		{
			href: resolve("/dashboard/settings"),
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
		if (p.includes("/cars")) return "My Garage";
		return "Dashboard";
	});

	async function handleSignOut() {
		sidebarOpen = false;
		await signOut();
		goto(resolve("/"));
	}
</script>

<!-- Fills the viewport below the fixed global navbar (h-16 = 4 rem) -->
<div class="flex overflow-hidden h-[calc(100vh-4rem)] bg-[var(--color-bg)]">
    <!-- ── Desktop sidebar ───────────────────────────────────────── -->
    <aside
        class="hidden flex-col w-60 border-r md:flex shrink-0 border-[var(--color-border)] bg-[var(--color-surface)]"
    >
        <!-- Nav links -->
        <nav class="overflow-y-auto flex-1 p-3 pt-4">
            <p
                class="px-3 mb-2 font-semibold tracking-widest uppercase text-[0.65rem] text-[var(--color-text-muted)]"
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
                        ? 'bg-[var(--color-accent-light)] text-accent'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}"
                >
                    <NavIcon class="size-4 shrink-0" />
                    {item.label}
                    {#if active}
                        <ChevronRight class="ml-auto opacity-60 size-3.5" />
                    {/if}
                </a>
            {/each}
        </nav>

        <!-- User section -->
        <div class="p-3 border-t border-[var(--color-border)]">
            <div class="flex gap-3 items-center p-2 rounded-xl">
                {#if data.user?.image}
                    <img
                        src={data.user.image}
                        alt={data.user.name}
                        class="object-cover rounded-full ring-1 size-8 ring-[var(--color-border)]"
                    />
                {:else}
                    <div
                        class="flex justify-center items-center text-xs font-bold text-white rounded-full size-8 shrink-0 bg-accent"
                    >
                        {userInitial}
                    </div>
                {/if}
                <div class="flex-1 min-w-0">
                    <p
                        class="text-xs font-semibold truncate text-[var(--color-text)]"
                    >
                        {data.user?.name}
                    </p>
                    <p
                        class="truncate text-[0.7rem] text-[var(--color-text-muted)]"
                    >
                        {data.user?.email}
                    </p>
                </div>
            </div>
            <button
                onclick={handleSignOut}
                class="flex gap-2.5 items-center py-2 px-3 mt-1 w-full text-xs font-medium text-red-500 rounded-xl transition-all duration-200 hover:bg-red-500/10"
            >
                <LogOut class="size-3.5" />
                Sign out
            </button>
        </div>
    </aside>

    <!-- ── Mobile sidebar overlay ────────────────────────────────── -->
    {#if sidebarOpen}
        <button
            class="fixed inset-0 z-40 md:hidden bg-black/40 backdrop-blur-sm"
            onclick={() => (sidebarOpen = false)}
            aria-label="Close sidebar"
        ></button>

        <div
            transition:fly={{ x: -280, duration: 240, opacity: 1 }}
            class="flex fixed left-0 top-16 z-50 flex-col w-72 border-r shadow-2xl md:hidden h-[calc(100vh-4rem)] border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <nav class="overflow-y-auto flex-1 p-3 pt-4">
                <p
                    class="px-3 mb-2 font-semibold tracking-widest uppercase text-[0.65rem] text-[var(--color-text-muted)]"
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
                            ? 'bg-[var(--color-accent-light)] text-accent'
                            : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}"
                    >
                        <MobileNavIcon class="size-4 shrink-0" />
                        {item.label}
                    </a>
                {/each}
            </nav>

            <div class="p-3 border-t border-[var(--color-border)]">
                <div class="flex gap-3 items-center p-2 rounded-xl">
                    {#if data.user?.image}
                        <img
                            src={data.user.image}
                            alt={data.user.name}
                            class="object-cover rounded-full size-8"
                        />
                    {:else}
                        <div
                            class="flex justify-center items-center text-sm font-bold text-white rounded-full size-8 shrink-0 bg-accent"
                        >
                            {userInitial}
                        </div>
                    {/if}
                    <div class="flex-1 min-w-0">
                        <p
                            class="text-xs font-semibold truncate text-[var(--color-text)]"
                        >
                            {data.user?.name}
                        </p>
                        <p
                            class="truncate text-[0.7rem] text-[var(--color-text-muted)]"
                        >
                            {data.user?.email}
                        </p>
                    </div>
                </div>
                <button
                    onclick={handleSignOut}
                    class="flex gap-2.5 items-center py-2 px-3 mt-1 w-full text-xs font-medium text-red-500 rounded-xl transition-all duration-200 hover:bg-red-500/10"
                >
                    <LogOut class="size-3.5" />
                    Sign out
                </button>
            </div>
        </div>
    {/if}

    <!-- ── Main content ───────────────────────────────────────────── -->
    <div class="flex overflow-hidden flex-col flex-1">
        <!-- Mobile-only bar: hamburger + page title -->
        <div
            class="flex gap-3 items-center px-4 h-12 border-b md:hidden shrink-0 border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <button
                onclick={() => (sidebarOpen = !sidebarOpen)}
                class="p-1.5 rounded-lg transition-all text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
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
        <main class="overflow-y-auto flex-1">
            {@render children()}
        </main>
    </div>
</div>
