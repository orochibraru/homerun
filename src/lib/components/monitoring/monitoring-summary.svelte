<script lang="ts">
	import { ArrowRight, BarChart3 } from "@lucide/svelte";
	import {
		formatCount as count,
		formatMs as ms,
		formatPercent as percent,
	} from "#lib/metrics-format.js";
	import { monitoringChanges } from "#lib/monitoring-changes.js";
	import type {
		MonitoringSummary,
		ServiceBreakdown,
	} from "#lib/services/monitoring.service.js";
	import ChangeBadge from "./change-badge.svelte";
	import MetricChart from "./metric-chart.svelte";

	interface Busiest extends ServiceBreakdown {
		href: string;
		name: string;
	}

	interface Props {
		busiest: Busiest[];
		href: string;
		monitoring: MonitoringSummary;
	}

	const { busiest, href, monitoring }: Props = $props();

	const traffic = $derived(monitoring.traffic);
	const external = $derived(monitoring.availability.external);

	const changes = $derived(monitoringChanges(monitoring));

	const tiles = $derived([
		{
			label: "Requests",
			metric: "requests" as const,
			value: count(traffic.requests),
		},
		{
			label: "Avg response",
			metric: "avgResponse" as const,
			value: ms(traffic.avgResponseMs),
		},
		{
			label: "Error rate",
			metric: "errorRate" as const,
			value: percent(traffic.status4xx + traffic.status5xx, traffic.requests),
		},
		{
			label: "Uptime",
			metric: "uptimePublic" as const,
			value: percent(external.ok, external.checks, 2),
		},
	]);
</script>

<section class="panel flex flex-col rounded-xl">
  <div class="panel-head">
    <h2 class="eyebrow flex items-center gap-1.5">
      <BarChart3 class="size-3" />
      Monitoring · today
    </h2>
    <a class="text-accent flex items-center gap-1 text-xs hover:underline" {href}>
      Open monitoring
      <ArrowRight class="size-3" />
    </a>
  </div>
  <div class="divide-border grid grid-cols-2 divide-x border-b sm:grid-cols-4">
    {#each tiles as tile (tile.label)}
      <div class="border-border min-w-0 px-4 py-3">
        <p class="text-text-muted text-xs">{tile.label}</p>
        <p class="metric mt-1">{tile.value}</p>
        <ChangeBadge change={changes[tile.metric]} label={monitoring.previous?.label} />
      </div>
    {/each}
  </div>
  <div class="grid flex-1 gap-4 p-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
    <MetricChart
      bucketSeconds={monitoring.bucketSeconds}
      empty="No requests through Traefik yet today."
      format={count}
      kind="bar"
      plain
      points={monitoring.trafficSeries.map((p) => ({ at: p.at, value: p.requests }))}
      title="Requests"
    />
    <div class="min-w-0">
      <p class="text-text-muted mb-2 text-xs">Busiest services today</p>
      {#if busiest.length === 0}
        <p class="text-text-subtle text-xs">No traffic recorded yet today.</p>
      {:else}
        <ul class="divide-border divide-y text-sm">
          {#each busiest as row (row.serviceId)}
            <li class="flex items-center justify-between gap-3 py-1.5">
              <a class="text-text min-w-0 truncate hover:underline" href={row.href}>
                {row.name}
              </a>
              <span class="text-text-muted shrink-0 text-xs tabular-nums">
                {count(row.requests)} · {ms(row.avgResponseMs)}
              </span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</section>
