<script lang="ts">
    import {
        ArrowRight,
        Car,
        Clock,
        DollarSign,
        Plus,
        TrendingUp,
        Wrench,
    } from "@lucide/svelte";
    import { resolve } from "$app/paths";
    import { formatCurrency } from "$lib/formatting";
    import { STATUS_COLORS } from "$lib/constants";
    import type { PageData } from "./$types";

    const { data }: { data: PageData } = $props();

    const statCards = $derived([
        {
            label: "Total Spent",
            value: formatCurrency(data.stats.totalSpent),
            icon: DollarSign,
            color: "bg-violet-50 text-violet-600",
            dark: "dark:bg-violet-950/40 dark:text-violet-400",
        },
        {
            label: "Cars",
            value: String(data.stats.carCount),
            icon: Car,
            color: "bg-blue-50 text-blue-600",
            dark: "dark:bg-blue-950/40 dark:text-blue-400",
        },
        {
            label: "Mods",
            value: String(data.stats.modCount),
            icon: Wrench,
            color: "bg-emerald-50 text-emerald-600",
            dark: "dark:bg-emerald-950/40 dark:text-emerald-400",
        },
        {
            label: "Most Expensive",
            value: data.stats.mostExpensiveMod
                ? formatCurrency(
                      data.stats.mostExpensiveMod.price +
                          data.stats.mostExpensiveMod.laborCost,
                  )
                : "—",
            sub: data.stats.mostExpensiveMod?.name ?? "No mods yet",
            icon: TrendingUp,
            color: "bg-orange-50 text-orange-600",
            dark: "dark:bg-orange-950/40 dark:text-orange-400",
        },
    ]);
</script>

<div class="p-6 md:p-8">
    <!-- Page header -->
    <div class="mb-8">
        <h1 class="text-2xl font-bold text-[var(--color-text)]">
            Welcome back, {data.user?.name?.split(" ")[0]} 👋
        </h1>
        <p class="mt-1 text-sm text-[var(--color-text-muted)]">
            Here's an overview of your garage and modifications.
        </p>
    </div>

    <!-- ── Stat cards ───────────────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-4 mb-8 lg:grid-cols-4">
        {#each statCards as card}
            {@const StatIcon = card.icon}
            <div
                class="p-5 rounded-2xl border transition-shadow hover:shadow-md border-[var(--color-border)] bg-[var(--color-surface)]"
            >
                <div class="flex justify-between items-start mb-3">
                    <div class="rounded-xl p-2.5 {card.color} {card.dark}">
                        <StatIcon class="size-5" />
                    </div>
                </div>
                <p class="text-2xl font-bold text-[var(--color-text)]">
                    {card.value}
                </p>
                <p
                    class="mt-0.5 text-xs font-medium text-[var(--color-text-muted)]"
                >
                    {card.label}
                </p>
                {#if card.sub}
                    <p
                        class="mt-1 truncate text-[0.7rem] text-[var(--color-text-subtle)]"
                    >
                        {card.sub}
                    </p>
                {/if}
            </div>
        {/each}
    </div>

    <!-- ── Bottom grid ───────────────────────────────────────────── -->
    <div class="grid gap-6 lg:grid-cols-3">
        <!-- Recent mods (2/3 width on lg) -->
        <div
            class="rounded-2xl border lg:col-span-2 border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <div
                class="flex justify-between items-center py-4 px-5 border-b border-[var(--color-border)]"
            >
                <div class="flex gap-2 items-center">
                    <Clock class="size-4 text-[var(--color-text-muted)]" />
                    <h2 class="text-sm font-semibold text-[var(--color-text)]">
                        Recent Mods
                    </h2>
                </div>
                <a
                    href={resolve("/dashboard/cars")}
                    class="flex gap-1 items-center text-xs font-medium hover:underline text-accent"
                >
                    View all <ArrowRight class="size-3" />
                </a>
            </div>

            {#if data.recentMods.length === 0}
                <div
                    class="flex flex-col justify-center items-center py-12 text-center"
                >
                    <Wrench
                        class="mb-3 opacity-40 size-8 text-[var(--color-text-muted)]"
                    />
                    <p
                        class="text-sm font-medium text-[var(--color-text-muted)]"
                    >
                        No mods yet
                    </p>
                    <p class="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                        Add your first mod to get started
                    </p>
                </div>
            {:else}
                <div class="divide-y divide-[var(--color-border)]">
                    {#each data.recentMods as mod}
                        <div class="flex gap-4 items-center py-3 px-5">
                            <div class="flex-1 min-w-0">
                                <p
                                    class="text-sm font-medium truncate text-[var(--color-text)]"
                                >
                                    {mod.name}
                                </p>
                                <p
                                    class="text-xs truncate text-[var(--color-text-muted)]"
                                >
                                    {mod.carLabel}
                                    {#if mod.brand}· {mod.brand}{/if}
                                </p>
                            </div>
                            <div class="flex flex-shrink-0 gap-2 items-center">
                                <span
                                    class="rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold capitalize
									{STATUS_COLORS[mod.status] ?? 'bg-gray-100 text-gray-600'}"
                                >
                                    {mod.status}
                                </span>
                                <span
                                    class="text-sm font-semibold text-[var(--color-text)]"
                                >
                                    {formatCurrency(mod.price + mod.laborCost)}
                                </span>
                            </div>
                        </div>
                    {/each}
                </div>
            {/if}
        </div>

        <!-- Quick actions (1/3 width on lg) -->
        <div
            class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <div class="py-4 px-5 border-b border-[var(--color-border)]">
                <h2 class="text-sm font-semibold text-[var(--color-text)]">
                    Quick Actions
                </h2>
            </div>
            <div class="p-4 space-y-2">
                <a
                    href={resolve("/dashboard/cars/new")}
                    class="flex gap-3 items-center py-3 px-4 w-full text-sm font-medium rounded-xl border transition-all duration-200 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:border-accent/40 hover:bg-[var(--color-accent-light)] hover:text-accent"
                >
                    <div
                        class="flex justify-center items-center rounded-lg size-8 bg-accent/10 text-accent"
                    >
                        <Car class="size-4" />
                    </div>
                    <div class="flex-1 min-w-0 text-left">
                        <p class="font-medium">Add a Car</p>
                        <p class="text-xs text-[var(--color-text-muted)]">
                            Register a new vehicle
                        </p>
                    </div>
                    <Plus class="size-4 text-[var(--color-text-muted)]" />
                </a>

                {#if data.stats.carCount > 0}
                    <a
                        href={resolve("/dashboard/cars")}
                        class="flex gap-3 items-center py-3 px-4 w-full text-sm font-medium rounded-xl border transition-all duration-200 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:border-accent/40 hover:bg-[var(--color-accent-light)] hover:text-accent"
                    >
                        <div
                            class="flex justify-center items-center text-emerald-600 rounded-lg size-8 bg-emerald-500/10"
                        >
                            <Wrench class="size-4" />
                        </div>
                        <div class="flex-1 min-w-0 text-left">
                            <p class="font-medium">Add a Mod</p>
                            <p class="text-xs text-[var(--color-text-muted)]">
                                Select a car first
                            </p>
                        </div>
                        <ArrowRight
                            class="size-4 text-[var(--color-text-muted)]"
                        />
                    </a>
                {/if}

                <a
                    href={resolve("/dashboard/cars")}
                    class="flex gap-3 items-center py-3 px-4 w-full text-sm font-medium rounded-xl border transition-all duration-200 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:border-accent/40 hover:bg-[var(--color-accent-light)] hover:text-accent"
                >
                    <div
                        class="flex justify-center items-center text-blue-600 rounded-lg size-8 bg-blue-500/10"
                    >
                        <Car class="size-4" />
                    </div>
                    <div class="flex-1 min-w-0 text-left">
                        <p class="font-medium">My Garage</p>
                        <p class="text-xs text-[var(--color-text-muted)]">
                            View all your cars
                        </p>
                    </div>
                    <ArrowRight class="size-4 text-[var(--color-text-muted)]" />
                </a>
            </div>
        </div>
    </div>
</div>
