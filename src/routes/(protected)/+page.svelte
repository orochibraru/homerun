<script lang="ts">
	import {
		AlertTriangle,
		ArrowRight,
		Clock,
		Cpu,
		HardDrive,
		MemoryStick,
		Plus,
		Server,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button";
	import { timeAgo } from "$lib/formatting";
	import type { SystemStats } from "$lib/services/system-stats.service";
	import { title } from "$lib/store/title";

	const { data } = $props();

	// Seeded once from the initial load, then diverges via the poll below :
	// untrack() is intentional, not a lint workaround.
	let systemStats = $state<SystemStats>(untrack(() => data.systemStats));

	onMount(() => {
		title.set("Dashboard");

		const interval = setInterval(async () => {
			const res = await fetch(resolve("/api/v1/system-stats"));
			if (res.ok) {
				systemStats = await res.json();
			}
		}, 5000);

		return () => clearInterval(interval);
	});

	function pct(used: number, total: number): number {
		if (total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (used / total) * 100));
	}

	function barColor(percent: number): string {
		if (percent >= 90) {
			return "bg-red-500";
		}
		if (percent >= 70) {
			return "bg-amber-500";
		}
		return "bg-accent";
	}

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
  <div class="mb-8 flex items-center justify-between">
    <div>
      <h1 class="text-2xl font-bold text-text">
        Welcome back, {data.user?.name?.split(" ")[0]} 👋
      </h1>
      <p class="mt-1 text-sm text-text-muted">
        Here's an overview of your deployed services.
      </p>
    </div>

    <Button href={resolve("/services/new")} size="sm">
      <Plus class="size-4" />
      Deploy a Service
    </Button>
  </div>

  {#if data.setupIssues.length > 0}
    <a
      class="mb-8 flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm transition-colors hover:bg-amber-100 dark:border-amber-900/40 dark:bg-amber-950/20 dark:hover:bg-amber-950/30"
      href={data.highlightFields.length > 0
        ? `${resolve("/settings")}?highlight=${data.highlightFields.join(",")}`
        : resolve("/settings")}
    >
      <AlertTriangle class="size-4 shrink-0 text-amber-600" />
      <span class="flex-1 text-amber-800 dark:text-amber-300">
        {data.setupIssues.length}
        {data.setupIssues.length === 1 ? "setup issue" : "setup issues"}
        found : {data.setupIssues[0].label.toLowerCase()}
        {data.setupIssues.length > 1 ? ", and more" : ""}.
      </span>
      <span
        class="shrink-0 font-medium text-amber-700 underline dark:text-amber-400"
        >Review</span
      >
    </a>
  {/if}

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

  <!-- ── System stats ─────────────────────────────────────────── -->
  <div class="mb-8 rounded-2xl border border-border bg-surface p-5">
    <h2 class="mb-4 text-sm font-semibold text-text">Host Resources</h2>
    <div class="grid gap-5 sm:grid-cols-3">
      <div>
        <div class="mb-1.5 flex items-center justify-between text-xs">
          <span class="flex items-center gap-1.5 font-medium text-text-muted">
            <Cpu class="size-3.5" />
            CPU
          </span>
          <span class="font-mono text-text-subtle"
            >{systemStats.cpuPercent.toFixed(0)}%</span
          >
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full transition-all duration-500 {barColor(
              systemStats.cpuPercent,
            )}"
            style="width: {systemStats.cpuPercent}%"
          ></div>
        </div>
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between text-xs">
          <span class="flex items-center gap-1.5 font-medium text-text-muted">
            <MemoryStick class="size-3.5" />
            RAM
          </span>
          <span class="font-mono text-text-subtle">
            {(systemStats.memUsedMb / 1024).toFixed(1)}
            /
            {(systemStats.memTotalMb / 1024).toFixed(1)}
            GB
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full transition-all duration-500 {barColor(
              pct(systemStats.memUsedMb, systemStats.memTotalMb),
            )}"
            style="width: {pct(systemStats.memUsedMb, systemStats.memTotalMb)}%"
          ></div>
        </div>
      </div>

      <div>
        <div class="mb-1.5 flex items-center justify-between text-xs">
          <span class="flex items-center gap-1.5 font-medium text-text-muted">
            <HardDrive class="size-3.5" />
            Disk
          </span>
          <span class="font-mono text-text-subtle">
            {#if systemStats.diskUsedGb !== null && systemStats.diskTotalGb !== null}
              {systemStats.diskUsedGb.toFixed(0)}
              /
              {systemStats.diskTotalGb.toFixed(0)}
              GB
            {:else}
              unavailable
            {/if}
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full transition-all duration-500 {barColor(
              pct(systemStats.diskUsedGb ?? 0, systemStats.diskTotalGb ?? 0),
            )}"
            style="width: {pct(
              systemStats.diskUsedGb ?? 0,
              systemStats.diskTotalGb ?? 0,
            )}%"
          ></div>
        </div>
      </div>
    </div>

    {#if systemStats.gpu}
      <div class="mt-5 border-t border-border pt-4">
        <div class="mb-1.5 flex items-center justify-between text-xs">
          <span class="font-medium text-text-muted"
            >GPU · {systemStats.gpu.name}</span
          >
          <span class="font-mono text-text-subtle">
            {systemStats.gpu.utilizationPercent}% ·
            {(systemStats.gpu.memUsedMb / 1024).toFixed(1)}
            /
            {(systemStats.gpu.memTotalMb / 1024).toFixed(1)}
            GB
          </span>
        </div>
        <div class="h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div
            class="h-full rounded-full transition-all duration-500 {barColor(
              systemStats.gpu.utilizationPercent,
            )}"
            style="width: {systemStats.gpu.utilizationPercent}%"
          ></div>
        </div>
      </div>
    {/if}
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
