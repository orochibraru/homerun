<script lang="ts">
  import { ArrowRight, Clock, Plus, Server } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
  import { timeAgo } from "$lib/formatting";
  import { title } from "$lib/store/title";

  const { data } = $props();

  onMount(() => title.set("Dashboard"));

  const statCards = $derived([
    {
      color: "bg-blue-50 text-blue-600",
      dark: "dark:bg-blue-950/40 dark:text-blue-400",
      icon: Server,
      label: "Total Services",
      value: String(data.stats.totalServices),
    },
    {
      color: "bg-emerald-50 text-emerald-600",
      dark: "dark:bg-emerald-950/40 dark:text-emerald-400",
      icon: Server,
      label: "Running",
      value: String(data.stats.running),
    },
  ]);
</script>

<div class="p-6 md:p-8">
  <!-- Page header -->
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-text">
      Welcome back, {data.user?.name?.split(" ")[0]} 👋
    </h1>
    <p class="mt-1 text-sm text-text-muted">
      Here's an overview of your deployed services.
    </p>
  </div>

  <!-- ── Stat cards ───────────────────────────────────────────── -->
  <div class="mb-8 grid grid-cols-2 gap-4">
    {#each statCards as card}
      {@const StatIcon = card.icon}
      <div
        class="rounded-2xl border border-border bg-surface p-5 transition-shadow hover:shadow-md"
      >
        <div class="mb-3 flex items-start justify-between">
          <div class="rounded-xl p-2.5 {card.color} {card.dark}">
            <StatIcon class="size-5" />
          </div>
        </div>
        <p class="text-2xl font-bold text-text">
          {card.value}
        </p>
        <p class="mt-0.5 text-xs font-medium text-text-muted">
          {card.label}
        </p>
      </div>
    {/each}
  </div>

  <!-- ── Bottom grid ───────────────────────────────────────────── -->
  <div class="grid gap-6 lg:grid-cols-3">
    <!-- Recent deployments (2/3 width on lg) -->
    <div class="rounded-2xl border border-border bg-surface lg:col-span-2">
      <div
        class="flex items-center justify-between border-b border-border px-5 py-4"
      >
        <div class="flex items-center gap-2">
          <Clock class="size-4 text-text-muted" />
          <h2 class="text-sm font-semibold text-text">Recent Deployments</h2>
        </div>
        <a
          class="text-accent flex items-center gap-1 text-xs font-medium hover:underline"
          href={resolve("/services")}
        >
          View all <ArrowRight class="size-3" />
        </a>
      </div>

      {#if data.recentDeployments.length === 0}
        <div
          class="flex flex-col items-center justify-center py-12 text-center"
        >
          <Server class="mb-3 size-8 text-text-muted opacity-40" />
          <p class="text-sm font-medium text-text-muted">No deployments yet</p>
          <p class="mt-0.5 text-xs text-text-subtle">
            Deploy your first service to get started
          </p>
        </div>
      {:else}
        <div class="divide-y divide-border">
          {#each data.recentDeployments as dep}
            <div class="flex items-center gap-4 px-5 py-3">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-text">
                  {dep.serviceName ?? "Unknown service"}
                </p>
                <p class="truncate text-xs text-text-muted">
                  {timeAgo(dep.createdAt)}
                </p>
              </div>
              <span
                class="rounded-full bg-surface-2 px-2.5 py-0.5 text-[0.65rem] font-semibold text-text-muted capitalize"
              >
                {dep.status}
              </span>
            </div>
          {/each}
        </div>
      {/if}
    </div>

    <!-- Quick actions (1/3 width on lg) -->
    <div class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">Quick Actions</h2>
      </div>
      <div class="space-y-2 p-4">
        <a
          class="hover:border-accent/40 hover:text-accent flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium text-text transition-all duration-200 hover:bg-[var(--color-accent-light)]"
          href={resolve("/services/new")}
        >
          <div
            class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
          >
            <Server class="size-4" />
          </div>
          <div class="min-w-0 flex-1 text-left">
            <p class="font-medium">Deploy a Service</p>
            <p class="text-xs text-text-muted">
              Point at an image, click deploy
            </p>
          </div>
          <Plus class="size-4 text-text-muted" />
        </a>

        {#if data.stats.totalServices > 0}
          <a
            class="hover:border-accent/40 hover:text-accent flex w-full items-center gap-3 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm font-medium text-text transition-all duration-200 hover:bg-[var(--color-accent-light)]"
            href={resolve("/services")}
          >
            <div
              class="flex size-8 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600"
            >
              <Server class="size-4" />
            </div>
            <div class="min-w-0 flex-1 text-left">
              <p class="font-medium">All Services</p>
              <p class="text-xs text-text-muted">View and manage services</p>
            </div>
            <ArrowRight class="size-4 text-text-muted" />
          </a>
        {/if}
      </div>
    </div>
  </div>
</div>
