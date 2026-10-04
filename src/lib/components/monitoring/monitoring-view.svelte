<script lang="ts">
	import { onMount } from "svelte";
	import { formatBytes } from "#lib/formatting.js";
	import {
		formatCount as count,
		formatMb as mb,
		formatMs as ms,
		formatPercent as percent,
	} from "#lib/metrics-format.js";
	import { monitoringChanges } from "#lib/monitoring-changes.js";
	import { MONITORING_RANGES } from "#lib/monitoring-ranges.js";
	import type { MonitoringSummary } from "#lib/services/monitoring.service.js";
	import { refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import ChangeBadge from "./change-badge.svelte";
	import MetricChart from "./metric-chart.svelte";

	interface Props {
		monitoring: MonitoringSummary;
		/** The time zone the server computed "today" in; the view resets it to the browser's when they differ. */
		zone: string;
		/** What the requests chart says when it has nothing to draw. */
		trafficEmpty?: string;
		/** Whose CPU and memory the resource cards describe, e.g. "the host". */
		resourceSubject?: string;
	}

	const {
		monitoring,
		resourceSubject,
		trafficEmpty = "No requests recorded in this range. Traffic is counted from Traefik's metrics, one reading a minute.",
		zone,
	}: Props = $props();

	const traffic = $derived(monitoring.traffic);
	const resources = $derived(monitoring.resources);
	const external = $derived(monitoring.availability.external);
	const internal = $derived(monitoring.availability.internal);
	const errors = $derived(traffic.status4xx + traffic.status5xx);

	onMount(() => {
		const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (browserZone && browserZone !== zone) {
			document.cookie = `tz=${encodeURIComponent(browserZone)}; path=/; max-age=31536000; samesite=lax`;
			void refreshAll();
		}
	});

	function rangeHref(range: string): string {
		const url = new URL(page.url.href);
		url.searchParams.set("range", range);
		return `${url.pathname}${url.search}`;
	}

	const suffix = $derived(resourceSubject ? ` (${resourceSubject})` : "");

	const changes = $derived(monitoringChanges(monitoring));

	const cards = $derived([
		{
			metric: "requests" as const,
			hint: `${count((traffic.requests / monitoring.spanSeconds) * 3600)} an hour on average`,
			label: "Requests",
			value: count(traffic.requests),
		},
		{
			hint: "Time Traefik waited on the service, per request",
			label: "Avg response time",
			metric: "avgResponse" as const,
			value: ms(traffic.avgResponseMs),
		},
		{
			hint: `${count(traffic.status5xx)} server errors, ${count(traffic.status4xx)} client errors`,
			label: "Error rate",
			metric: "errorRate" as const,
			value: percent(errors, traffic.requests),
		},
		{
			hint: `${formatBytes(traffic.bytesIn)} received`,
			label: "Bandwidth served",
			metric: "bandwidth" as const,
			value: formatBytes(traffic.bytesOut),
		},
		{
			hint: external.checks
				? `${count(external.checks)} checks, ${ms(external.avgLatencyMs)} on average`
				: "No public checks in this range",
			label: "Uptime (public)",
			metric: "uptimePublic" as const,
			value: percent(external.ok, external.checks, 2),
		},
		{
			hint: internal.checks
				? `${count(internal.checks)} checks, ${ms(internal.avgLatencyMs)} on average`
				: "No network checks in this range",
			label: "Uptime (network)",
			metric: "uptimeNetwork" as const,
			value: percent(internal.ok, internal.checks, 2),
		},
		{
			hint:
				resources.peakCpuPercent === null
					? "No samples in this range"
					: `peak ${resources.peakCpuPercent.toFixed(0)}%`,
			label: `Avg CPU${suffix}`,
			metric: "avgCpu" as const,
			value:
				resources.avgCpuPercent === null
					? "—"
					: `${resources.avgCpuPercent.toFixed(1)}%`,
		},
		{
			hint:
				resources.peakMemUsedMb === null
					? "No samples in this range"
					: `peak ${mb(resources.peakMemUsedMb)}${resources.memLimitMb ? ` of ${mb(resources.memLimitMb)}` : ""}`,
			label: `Avg memory${suffix}`,
			metric: "avgMemory" as const,
			value: mb(resources.avgMemUsedMb),
		},
	]);
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-text-muted text-sm">
      {#if monitoring.since}
        Since {new Date(monitoring.since).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: monitoring.range === "today" ? "short" : undefined,
        })}
      {:else}
        Everything recorded, up to a year back
      {/if}
      {#if monitoring.previous}
        <span class="text-text-subtle">· changes {monitoring.previous.label}</span>
      {/if}
    </p>
    <nav
      aria-label="Range"
      class="border-border inline-flex flex-wrap rounded-lg border p-0.5"
    >
      {#each MONITORING_RANGES as range (range.id)}
        <a
          aria-current={monitoring.range === range.id ? "page" : undefined}
          class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {monitoring.range ===
          range.id
            ? 'bg-accent-light text-accent'
            : 'text-text-muted hover:text-text'}"
          data-sveltekit-noscroll
          href={rangeHref(range.id)}
        >
          {range.label}
        </a>
      {/each}
    </nav>
  </div>

  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {#each cards as card (card.label)}
      <div class="panel rounded-md p-4">
        <p class="text-text-muted text-xs">{card.label}</p>
        <p class="mt-1 flex items-baseline gap-2">
          <span class="metric text-text">{card.value}</span>
          <ChangeBadge change={changes[card.metric]} label={monitoring.previous?.label} />
        </p>
        <p class="text-text-subtle mt-1 truncate text-xs" title={card.hint}>
          {card.hint}
        </p>
      </div>
    {/each}
  </div>

  <div class="grid gap-3 xl:grid-cols-2">
    <MetricChart
      bucketSeconds={monitoring.bucketSeconds}
      empty={trafficEmpty}
      format={count}
      kind="bar"
      points={monitoring.trafficSeries.map((p) => ({ at: p.at, value: p.requests }))}
      title="Requests"
    />
    <MetricChart
      bucketSeconds={monitoring.bucketSeconds}
      format={(value) => ms(value)}
      points={monitoring.trafficSeries.map((p) => ({
        at: p.at,
        value: p.avgResponseMs,
      }))}
      title="Avg response time"
    />
    <MetricChart
      bucketSeconds={monitoring.bucketSeconds}
      format={(value) => `${value.toFixed(1)}%`}
      points={monitoring.resourceSeries.map((p) => ({
        at: p.at,
        value: p.cpuPercent,
      }))}
      title="CPU{suffix}"
    />
    <MetricChart
      bucketSeconds={monitoring.bucketSeconds}
      format={mb}
      points={monitoring.resourceSeries.map((p) => ({
        at: p.at,
        value: p.memUsedMb,
      }))}
      title="Memory{suffix}"
    />
  </div>
</div>
