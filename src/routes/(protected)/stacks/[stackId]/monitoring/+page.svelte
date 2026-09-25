<script lang="ts">
	import { Clock } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import ServiceUsageTable from "$lib/components/service-usage-table.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set(`${data.stack.name} · Monitoring`));

	const running = $derived(
		data.services.filter((svc) => svc.currentStatus === "running").length,
	);
	const serviceIds = $derived(data.services.map((svc) => svc.id));
</script>

<div class="mb-4 grid items-start gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
  <div class="panel divide-border flex divide-x rounded-xl">
    <div class="min-w-0 flex-1 px-4 py-3">
      <p class="eyebrow flex items-center gap-1.5">
        <span class="bg-accent size-1.5 rounded-full"></span>
        Services
      </p>
      <p class="metric mt-2">{data.services.length}</p>
    </div>
    <div class="min-w-0 flex-1 px-4 py-3">
      <p class="eyebrow flex items-center gap-1.5">
        <span class="size-1.5 rounded-full bg-emerald-500"></span>
        Running
      </p>
      <p class="metric mt-2">{running}</p>
    </div>
  </div>

  <ServiceUsageTable {serviceIds} title="Resource usage" />
</div>

<div class="panel rounded-xl">
  <div class="panel-head">
    <h2 class="eyebrow flex items-center gap-1.5">
      <Clock class="size-3" />
      Recent deployments
    </h2>
  </div>
  {#if data.recentDeployments.length === 0}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      Nothing deployed in this stack yet.
    </p>
  {:else}
    <div class="divide-border divide-y">
      {#each data.recentDeployments as dep (dep.id)}
        <a
          class="hover:bg-surface-2 flex items-center gap-3 px-4 py-2.5 transition-colors"
          href="{resolve('/services')}/{dep.serviceId}"
        >
          <StatusBadge status={dep.status} />
          <span class="text-text min-w-0 flex-1 truncate text-sm">
            {dep.serviceName ?? "Unknown service"}
          </span>
          <span class="tabular-nums text-text-subtle shrink-0 text-[0.6875rem]">
            {timeAgo(dep.createdAt)}
          </span>
        </a>
      {/each}
    </div>
  {/if}
</div>
