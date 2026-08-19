<script lang="ts">
    import { ArrowRight, Clock, Plus, Server } from "@lucide/svelte";
    import { onMount } from "svelte";
    import { resolve } from "$app/paths";
    import { timeAgo } from "$lib/formatting";
    import { title } from "$lib/store/title";
    import type { PageData } from "./$types";

    const { data }: { data: PageData } = $props();

    onMount(() => title.set("Dashboard"));

    const statCards = $derived([
        {
            label: "Total Services",
            value: String(data.stats.totalServices),
            icon: Server,
            color: "bg-blue-50 text-blue-600",
            dark: "dark:bg-blue-950/40 dark:text-blue-400",
        },
        {
            label: "Running",
            value: String(data.stats.running),
            icon: Server,
            color: "bg-emerald-50 text-emerald-600",
            dark: "dark:bg-emerald-950/40 dark:text-emerald-400",
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
            Here's an overview of your deployed services.
        </p>
    </div>

    <!-- ── Stat cards ───────────────────────────────────────────── -->
    <div class="grid grid-cols-2 gap-4 mb-8">
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
            </div>
        {/each}
    </div>

    <!-- ── Bottom grid ───────────────────────────────────────────── -->
    <div class="grid gap-6 lg:grid-cols-3">
        <!-- Recent deployments (2/3 width on lg) -->
        <div
            class="rounded-2xl border lg:col-span-2 border-[var(--color-border)] bg-[var(--color-surface)]"
        >
            <div
                class="flex justify-between items-center py-4 px-5 border-b border-[var(--color-border)]"
            >
                <div class="flex gap-2 items-center">
                    <Clock class="size-4 text-[var(--color-text-muted)]" />
                    <h2 class="text-sm font-semibold text-[var(--color-text)]">
                        Recent Deployments
                    </h2>
                </div>
                <a
                    href={resolve("/services")}
                    class="flex gap-1 items-center text-xs font-medium hover:underline text-accent"
                >
                    View all <ArrowRight class="size-3" />
                </a>
            </div>

            {#if data.recentDeployments.length === 0}
                <div
                    class="flex flex-col justify-center items-center py-12 text-center"
                >
                    <Server
                        class="mb-3 opacity-40 size-8 text-[var(--color-text-muted)]"
                    />
                    <p
                        class="text-sm font-medium text-[var(--color-text-muted)]"
                    >
                        No deployments yet
                    </p>
                    <p class="mt-0.5 text-xs text-[var(--color-text-subtle)]">
                        Deploy your first service to get started
                    </p>
                </div>
            {:else}
                <div class="divide-y divide-[var(--color-border)]">
                    {#each data.recentDeployments as dep}
                        <div class="flex gap-4 items-center py-3 px-5">
                            <div class="flex-1 min-w-0">
                                <p
                                    class="text-sm font-medium truncate text-[var(--color-text)]"
                                >
                                    {dep.serviceName ?? "Unknown service"}
                                </p>
                                <p
                                    class="text-xs truncate text-[var(--color-text-muted)]"
                                >
                                    {timeAgo(dep.createdAt)}
                                </p>
                            </div>
                            <span
                                class="rounded-full px-2.5 py-0.5 text-[0.65rem] font-semibold capitalize bg-[var(--color-surface-2)] text-[var(--color-text-muted)]"
                            >
                                {dep.status}
                            </span>
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
                    href={resolve("/services/new")}
                    class="flex gap-3 items-center py-3 px-4 w-full text-sm font-medium rounded-xl border transition-all duration-200 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:border-accent/40 hover:bg-[var(--color-accent-light)] hover:text-accent"
                >
                    <div
                        class="flex justify-center items-center rounded-lg size-8 bg-accent/10 text-accent"
                    >
                        <Server class="size-4" />
                    </div>
                    <div class="flex-1 min-w-0 text-left">
                        <p class="font-medium">Deploy a Service</p>
                        <p class="text-xs text-[var(--color-text-muted)]">
                            Point at an image, click deploy
                        </p>
                    </div>
                    <Plus class="size-4 text-[var(--color-text-muted)]" />
                </a>

                {#if data.stats.totalServices > 0}
                    <a
                        href={resolve("/services")}
                        class="flex gap-3 items-center py-3 px-4 w-full text-sm font-medium rounded-xl border transition-all duration-200 border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-text)] hover:border-accent/40 hover:bg-[var(--color-accent-light)] hover:text-accent"
                    >
                        <div
                            class="flex justify-center items-center text-blue-600 rounded-lg size-8 bg-blue-500/10"
                        >
                            <Server class="size-4" />
                        </div>
                        <div class="flex-1 min-w-0 text-left">
                            <p class="font-medium">All Services</p>
                            <p class="text-xs text-[var(--color-text-muted)]">
                                View and manage services
                            </p>
                        </div>
                        <ArrowRight class="size-4 text-[var(--color-text-muted)]" />
                    </a>
                {/if}
            </div>
        </div>
    </div>
</div>
