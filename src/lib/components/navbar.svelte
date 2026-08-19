<script lang="ts">
	import {
		ChevronDown,
		LayoutDashboard,
		Loader2,
		LogOut,
		Menu,
		Moon,
		Sun,
		Wrench,
		X,
		Zap,
	} from "@lucide/svelte";
	import { mode, toggleMode } from "mode-watcher";
	import { fly } from "svelte/transition";
	import { browser } from "$app/environment";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { signOut, useSession } from "$lib/auth-client";
	import { Button } from "$lib/components/ui/button";
	import { navLinks } from "$lib/nav";

	const session = useSession();

	let mobileOpen = $state(false);
	let dropdownOpen = $state(false);
	let scrolled = $state(false);

	$effect(() => {
		if (!browser) return;
		const handleScroll = () => {
			scrolled = window.scrollY > 10;
		};
		window.addEventListener("scroll", handleScroll, { passive: true });
		return () => window.removeEventListener("scroll", handleScroll);
	});

	const visibleLinks = $derived(
		navLinks.filter((link) => !link.requiresAuth || !!$session.data?.user),
	);

	const userInitial = $derived(
		$session.data?.user?.name?.[0]?.toUpperCase() ?? "?",
	);

	async function handleSignOut() {
		dropdownOpen = false;
		mobileOpen = false;
		await signOut();
		goto(resolve("/"));
	}

	function closeAll() {
		dropdownOpen = false;
		mobileOpen = false;
	}

	// Svelte action: closes dropdown when clicking outside
	function clickOutside(node: HTMLElement) {
		function handler(event: MouseEvent) {
			if (!node.contains(event.target as Node)) {
				dropdownOpen = false;
			}
		}
		document.addEventListener("mousedown", handler, true);
		return {
			destroy() {
				document.removeEventListener("mousedown", handler, true);
			},
		};
	}
</script>

<header
    class="fixed top-0 right-0 left-0 z-50 transition-all duration-300 {scrolled
        ? 'bg-[var(--color-nav-scrolled)] shadow-sm backdrop-blur-md border-b border-[var(--color-border)]'
        : 'bg-[var(--color-bg)]/80 backdrop-blur-sm'}"
>
    <nav
        class="flex justify-between items-center px-4 mx-auto max-w-7xl h-16 sm:px-6 lg:px-8"
    >
        <!-- ── Logo ─────────────────────────────────────── -->
        <a
            href={resolve("/")}
            onclick={closeAll}
            class="flex gap-1 items-center text-lg font-bold select-none"
        >
            <Zap class="size-5 text-accent" />
            <span class="text-[var(--color-text)]">Mods</span><span
                class="text-accent">Parts</span
            >
        </a>

        <!-- ── Desktop nav links ────────────────────────── -->
        <div class="hidden gap-1 items-center md:flex">
            {#each visibleLinks as link}
                <a
                    href={link.href}
                    class="rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200
						{page.url.pathname === link.href
                        ? 'bg-[var(--color-accent-light)] text-accent'
                        : 'text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]'}"
                >
                    {link.label}
                </a>
            {/each}
        </div>

        <!-- ── Right side ─────────────────────────────────────── -->
        <div class="flex gap-1 items-center">
            <!-- Dark mode toggle -->
            <button
                onclick={toggleMode}
                aria-label="Toggle dark mode"
                class="p-2 rounded-lg transition-all duration-200 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
            >
                {#if mode.current === "dark"}
                    <Sun class="size-4" />
                {:else}
                    <Moon class="size-4" />
                {/if}
            </button>
            {#if $session.isPending}
                <!-- Loading skeleton -->
                <div
                    class="hidden w-28 h-8 rounded-xl animate-pulse md:block bg-[var(--color-surface-2)]"
                ></div>
            {:else if $session.data?.user}
                <!-- ── User dropdown (desktop) ──────────────── -->
                <div class="hidden relative md:block" use:clickOutside>
                    <button
                        onclick={() => (dropdownOpen = !dropdownOpen)}
                        class="flex items-center gap-2 rounded-xl border border-transparent px-3 py-1.5 text-[var(--color-text)] transition-all duration-200 hover:border-[var(--color-border)] hover:bg-[var(--color-surface-2)]
							{dropdownOpen
                            ? 'border-[var(--color-border)] bg-[var(--color-surface-2)]'
                            : ''}"
                    >
                        {#if $session.data.user.image}
                            <img
                                src={$session.data.user.image}
                                alt={$session.data.user.name}
                                class="object-cover rounded-full ring-1 size-7 ring-[var(--color-border)]"
                            />
                        {:else}
                            <div
                                class="flex justify-center items-center text-xs font-bold text-white rounded-full size-7 shrink-0 bg-accent"
                            >
                                {userInitial}
                            </div>
                        {/if}
                        <span class="text-sm font-medium max-w-[8rem] truncate"
                            >{$session.data.user.name}</span
                        >
                        <ChevronDown
                            class="size-3.5 text-[var(--color-text-muted)] transition-transform duration-200
								{dropdownOpen ? 'rotate-180' : ''}"
                        />
                    </button>

                    {#if dropdownOpen}
                        <div
                            transition:fly={{
                                y: -6,
                                duration: 150,
                                opacity: 0,
                            }}
                            class="overflow-hidden absolute right-0 top-full mt-2 w-56 rounded-2xl border shadow-xl border-[var(--color-border)] bg-[var(--color-surface)]"
                        >
                            <div
                                class="py-3 px-4 border-b border-[var(--color-border)]"
                            >
                                <p
                                    class="text-xs font-medium truncate text-[var(--color-text)]"
                                >
                                    {$session.data.user.name}
                                </p>
                                <p
                                    class="mt-0.5 text-xs truncate text-[var(--color-text-muted)]"
                                >
                                    {$session.data.user.email}
                                </p>
                            </div>
                            <div class="p-1.5">
                                <a
                                    href={resolve("/dashboard")}
                                    onclick={closeAll}
                                    class="flex gap-3 items-center py-2 px-3 text-sm rounded-lg transition-all duration-200 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                                >
                                    <LayoutDashboard
                                        class="size-4 text-[var(--color-text-muted)]"
                                    />
                                    Dashboard
                                </a>
                                <a
                                    href={resolve("/dashboard/cars")}
                                    onclick={closeAll}
                                    class="flex gap-3 items-center py-2 px-3 text-sm rounded-lg transition-all duration-200 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                                >
                                    <Wrench
                                        class="size-4 text-[var(--color-text-muted)]"
                                    />
                                    My Garage
                                </a>
                                <div
                                    class="my-1.5 h-px bg-[var(--color-border)]"
                                ></div>
                                <button
                                    onclick={handleSignOut}
                                    class="flex gap-3 items-center py-2 px-3 w-full text-sm text-red-500 rounded-lg transition-all duration-200 hover:bg-red-500/10"
                                >
                                    <LogOut class="size-4" />
                                    Sign out
                                </button>
                            </div>
                        </div>
                    {/if}
                </div>
            {:else}
                <!-- ── Auth buttons (desktop) ────────────────── -->
                <div class="hidden gap-2 items-center md:flex">
                    <Button
                        href={resolve("/auth/sign-in")}
                        variant="ghost"
                        size="sm"
                        class="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
                    >
                        Sign in
                    </Button>
                    <Button
                        href={resolve("/auth/sign-up")}
                        size="sm"
                        class="text-white border-0 shadow-sm bg-accent shadow-accent/30 hover:bg-accent-dark"
                    >
                        Sign up
                    </Button>
                </div>
            {/if}

            <!-- ── Mobile hamburger ──────────────────────── -->
            <button
                onclick={() => (mobileOpen = !mobileOpen)}
                class="p-2 rounded-lg transition-all duration-200 md:hidden text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                aria-label="Toggle navigation menu"
            >
                {#if mobileOpen}
                    <X class="size-5" />
                {:else}
                    <Menu class="size-5" />
                {/if}
            </button>
        </div>
    </nav>

    <!-- ── Mobile menu ────────────────────────────── -->
    {#if mobileOpen}
        <div
            transition:fly={{ y: -8, duration: 200, opacity: 0 }}
            class="border-t shadow-lg md:hidden border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <div class="py-3 px-4 mx-auto max-w-7xl">
                <!-- Nav links -->
                {#if visibleLinks.length > 0}
                    <div class="mb-3 space-y-1">
                        {#each visibleLinks as link}
                            <a
                                href={link.href}
                                onclick={closeAll}
                                class="flex items-center rounded-xl px-4 py-2.5 text-sm font-medium transition-all duration-200
									{page.url.pathname === link.href
                                    ? 'bg-[var(--color-accent-light)] text-accent'
                                    : 'text-[var(--color-text)] hover:bg-[var(--color-surface-2)]'}"
                            >
                                {link.label}
                            </a>
                        {/each}
                    </div>
                    <div class="mb-3 h-px bg-[var(--color-border)]"></div>
                {/if}

                {#if $session.isPending}
                    <div class="flex justify-center items-center py-4">
                        <Loader2
                            class="animate-spin size-5 text-[var(--color-text-muted)]"
                        />
                    </div>
                {:else if $session.data?.user}
                    <!-- User info -->
                    <div class="flex gap-3 items-center px-2 mb-3">
                        {#if $session.data.user.image}
                            <img
                                src={$session.data.user.image}
                                alt={$session.data.user.name}
                                class="object-cover rounded-full size-9"
                            />
                        {:else}
                            <div
                                class="flex justify-center items-center text-sm font-bold text-white rounded-full size-9 shrink-0 bg-accent"
                            >
                                {userInitial}
                            </div>
                        {/if}
                        <div class="min-w-0">
                            <p
                                class="text-sm font-medium truncate text-[var(--color-text)]"
                            >
                                {$session.data.user.name}
                            </p>
                            <p
                                class="text-xs truncate text-[var(--color-text-muted)]"
                            >
                                {$session.data.user.email}
                            </p>
                        </div>
                    </div>
                    <div class="space-y-1">
                        <a
                            href={resolve("/dashboard/cars")}
                            onclick={closeAll}
                            class="flex gap-3 items-center py-2.5 px-4 text-sm rounded-xl transition-all duration-200 text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                        >
                            <Wrench
                                class="size-4 text-[var(--color-text-muted)]"
                            />
                            My Garage
                        </a>
                        <button
                            onclick={handleSignOut}
                            class="flex gap-3 items-center py-2.5 px-4 w-full text-sm text-red-500 rounded-xl transition-all duration-200 hover:bg-red-500/10"
                        >
                            <LogOut class="size-4" />
                            Sign out
                        </button>
                    </div>
                {:else}
                    <!-- Auth buttons -->
                    <div class="grid grid-cols-2 gap-2">
                        <a
                            href={resolve("/auth/sign-in")}
                            onclick={closeAll}
                            class="flex justify-center items-center py-2.5 px-4 text-sm font-medium rounded-xl border transition-all duration-200 border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-2)]"
                        >
                            Sign in
                        </a>
                        <a
                            href={resolve("/auth/sign-up")}
                            onclick={closeAll}
                            class="flex justify-center items-center py-2.5 px-4 text-sm font-medium text-white rounded-xl transition-all duration-200 bg-accent hover:bg-accent-dark"
                        >
                            Sign up
                        </a>
                    </div>
                {/if}

                <!-- Dark mode row -->
                <div class="pt-3 mt-3 border-t border-[var(--color-border)]">
                    <button
                        onclick={toggleMode}
                        class="flex gap-3 items-center py-2.5 px-4 w-full text-sm font-medium rounded-xl transition-all duration-200 text-[var(--color-text-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-text)]"
                    >
                        {#if mode.current === "dark"}
                            <Sun class="size-4" />
                            Switch to light mode
                        {:else}
                            <Moon class="size-4" />
                            Switch to dark mode
                        {/if}
                    </button>
                </div>
            </div>
        </div>
    {/if}
</header>
