<script lang="ts">
	import {
		AlertTriangle,
		ArrowRight,
		Clock,
		Plus,
		Server,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import HostResources from "$lib/components/host-resources.svelte";
	import { Button } from "$lib/components/ui/button";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import type { ContainerStatus } from "$lib/types";

	const { data } = $props();

	onMount(() => {
		title.set("Dashboard");
	});

	function statusDot(status: ContainerStatus): string {
		if (status === "running") {
			return "bg-emerald-500";
		}
		if (status === "failed" || status === "missing") {
			return "bg-red-500";
		}
		if (status === "stopped") {
			return "bg-zinc-400";
		}
		return "bg-amber-500";
	}

	const statCards = $derived([
		{
			dot: "bg-accent",
			label: "Services",
			value: String(data.stats.totalServices),
		},
		{
			dot: "bg-emerald-500",
			label: "Running",
			value: String(data.stats.running),
		},
	]);
</script>

<div class="p-5 md:p-6">
  <div class="mb-5">
    <h1 class="text-text text-lg font-semibold tracking-tight">
      Welcome back, {data.user?.name?.split(" ")[0]}
    </h1>
    <p class="text-text-muted mt-0.5 text-xs">
      Here's an overview of your deployed services.
    </p>
  </div>

  {#if data.setupIssues.length > 0}
    <a
      class="mb-5 flex items-center gap-2.5 border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs transition-colors hover:bg-amber-400/15"
      href={data.highlightFields.length > 0
        ? `${resolve("/settings")}?highlight=${data.highlightFields.join(",")}`
        : resolve("/settings")}
    >
      <AlertTriangle class="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span class="flex-1 text-amber-700 dark:text-amber-300">
        {data.setupIssues.length}
        {data.setupIssues.length === 1 ? "setup issue" : "setup issues"}
        found : {data.setupIssues[0].label.toLowerCase()}
        {data.setupIssues.length > 1 ? ", and more" : ""}.
      </span>
      <span class="eyebrow shrink-0 text-amber-700 dark:text-amber-400">Review</span>
    </a>
  {/if}

  <div class="mb-4 grid items-start gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
    <div class="panel divide-border flex divide-x">
      {#each statCards as card (card.label)}
        <div class="min-w-0 flex-1 px-4 py-3">
          <p class="eyebrow flex items-center gap-1.5">
            <span class="size-1.5 rounded-full {card.dot}"></span>
            {card.label}
          </p>
          <p class="metric mt-2">{card.value}</p>
        </div>
      {/each}
    </div>

    <HostResources />
  </div>

  <div class="grid items-start gap-4 lg:grid-cols-3">
    <div class="panel lg:col-span-2">
      <div class="panel-head">
        <h2 class="eyebrow flex items-center gap-1.5">
          <Clock class="size-3" />
          Recent Deployments
        </h2>
        <a
          class="text-accent text-xs font-medium hover:underline"
          href={resolve("/services")}
        >
          View all
        </a>
      </div>

      {#if data.recentDeployments.length === 0}
        <div class="flex flex-col items-center justify-center px-4 py-10 text-center">
          <Server class="text-text-subtle mb-2 size-5" />
          <p class="text-text-muted text-xs">No deployments yet</p>
          <p class="text-text-subtle mt-0.5 text-[0.6875rem]">
            Deploy your first service to get started
          </p>
        </div>
      {:else}
        <div class="divide-border divide-y">
          {#each data.recentDeployments as dep (dep.id)}
            <a
              class="hover:bg-surface-2 flex items-center gap-3 px-3.5 py-2 transition-colors"
              href="{resolve('/services')}/{dep.serviceId}"
            >
              <span class="size-1.5 shrink-0 rounded-full {statusDot(dep.status)}"></span>
              <span class="text-text min-w-0 flex-1 truncate text-sm">
                {dep.serviceName ?? "Unknown service"}
              </span>
              <span class="tabular-nums text-text-subtle shrink-0 text-[0.6875rem]">
                {timeAgo(dep.createdAt)}
              </span>
              <span class="text-text-subtle w-20 shrink-0 text-right text-xs">
                {dep.status}
              </span>
            </a>
          {/each}
        </div>
      {/if}
    </div>

    <div class="panel">
      <div class="panel-head">
        <h2 class="eyebrow">Quick Actions</h2>
      </div>
      <div class="divide-border divide-y">
        <a
          class="hover:bg-surface-2 group/qa flex items-center gap-3 px-3.5 py-2.5 transition-colors"
          href={resolve("/services/new")}
        >
          <Server class="text-text-subtle group-hover/qa:text-accent size-4 shrink-0" />
          <span class="min-w-0 flex-1">
            <span class="text-text block text-sm font-medium">Deploy a Service</span>
            <span class="text-text-subtle block text-[0.6875rem]">
              Point at an image, click deploy
            </span>
          </span>
          <Plus class="text-text-subtle size-3.5 shrink-0" />
        </a>

        {#if data.stats.totalServices > 0}
          <a
            class="hover:bg-surface-2 group/qa flex items-center gap-3 px-3.5 py-2.5 transition-colors"
            href={resolve("/services")}
          >
            <Server class="text-text-subtle group-hover/qa:text-accent size-4 shrink-0" />
            <span class="min-w-0 flex-1">
              <span class="text-text block text-sm font-medium">All Services</span>
              <span class="text-text-subtle block text-[0.6875rem]">
                View and manage services
              </span>
            </span>
            <ArrowRight class="text-text-subtle size-3.5 shrink-0" />
          </a>
        {/if}
      </div>
    </div>
  </div>
</div>
