<script lang="ts">
	import { onMount } from "svelte";
	import { invalidateAll } from "$app/navigation";
	import { page } from "$app/state";
	import { ANALYTICS_RANGES } from "$lib/analytics-ranges";
	import { formatBytes } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import AnalyticsChart from "./analytics-chart.svelte";

	const { data } = $props();

	const analytics = $derived(data.analytics);
	const traffic = $derived(analytics.traffic);
	const resources = $derived(analytics.resources);

	onMount(() => {
		title.set(`${data.service.name} · Analytics`);
		const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (zone && zone !== data.zone) {
			document.cookie = `tz=${encodeURIComponent(zone)}; path=/; max-age=31536000; samesite=lax`;
			void invalidateAll();
		}
	});

	function rangeHref(range: string): string {
		const url = new URL(page.url);
		url.searchParams.set("range", range);
		return `${url.pathname}${url.search}`;
	}

	function count(value: number): string {
		return new Intl.NumberFormat(undefined, {
			maximumFractionDigits: 1,
			notation: value >= 10_000 ? "compact" : "standard",
		}).format(value);
	}

	function ms(value: number | null): string {
		if (value === null) {
			return "—";
		}
		return value >= 1000
			? `${(value / 1000).toFixed(2)} s`
			: `${Math.round(value)} ms`;
	}

	function percent(part: number, whole: number, digits = 1): string {
		return whole ? `${((part / whole) * 100).toFixed(digits)}%` : "—";
	}

	function mb(value: number | null): string {
		if (value === null) {
			return "—";
		}
		return value >= 1024
			? `${(value / 1024).toFixed(2)} GB`
			: `${Math.round(value)} MB`;
	}

	const errors = $derived(traffic.status4xx + traffic.status5xx);
	const external = $derived(analytics.availability.external);
	const internal = $derived(analytics.availability.internal);

	const cards = $derived([
		{
			hint: `${count((traffic.requests / analytics.spanSeconds) * 3600)} an hour on average`,
			label: "Requests",
			value: count(traffic.requests),
		},
		{
			hint: "Time Traefik waited on the service, per request",
			label: "Avg response time",
			value: ms(traffic.avgResponseMs),
		},
		{
			hint: `${count(traffic.status5xx)} server errors, ${count(traffic.status4xx)} client errors`,
			label: "Error rate",
			value: percent(errors, traffic.requests),
		},
		{
			hint: `${formatBytes(traffic.bytesIn)} received`,
			label: "Bandwidth served",
			value: formatBytes(traffic.bytesOut),
		},
		{
			hint: external.checks
				? `${count(external.checks)} checks, ${ms(external.avgLatencyMs)} on average`
				: "No public checks in this range",
			label: "Uptime (public)",
			value: percent(external.ok, external.checks, 2),
		},
		{
			hint: internal.checks
				? `${count(internal.checks)} checks, ${ms(internal.avgLatencyMs)} on average`
				: "No network checks in this range",
			label: "Uptime (network)",
			value: percent(internal.ok, internal.checks, 2),
		},
		{
			hint:
				resources.peakCpuPercent === null
					? "No samples in this range"
					: `peak ${resources.peakCpuPercent.toFixed(0)}%`,
			label: "Avg CPU",
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
			label: "Avg memory",
			value: mb(resources.avgMemUsedMb),
		},
	]);
</script>

<div class="space-y-5">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-text-muted text-sm">
      {#if analytics.since}
        Since {new Date(analytics.since).toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: analytics.range === "today" ? "short" : undefined,
        })}
      {:else}
        Everything recorded, up to a year back
      {/if}
    </p>
    <nav
      aria-label="Range"
      class="border-border inline-flex flex-wrap rounded-lg border p-0.5"
    >
      {#each ANALYTICS_RANGES as range (range.id)}
        <a
          aria-current={analytics.range === range.id ? "page" : undefined}
          class="rounded-md px-2.5 py-1 text-xs font-medium transition-colors {analytics.range ===
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
        <p class="metric text-text mt-1">{card.value}</p>
        <p class="text-text-subtle mt-1 truncate text-xs" title={card.hint}>
          {card.hint}
        </p>
      </div>
    {/each}
  </div>

  <div class="grid gap-3 xl:grid-cols-2">
    <AnalyticsChart
      bucketSeconds={analytics.bucketSeconds}
      empty={data.service.dnsResolvable
        ? "No requests recorded in this range. Traffic is counted from Traefik's metrics, one reading a minute."
        : "This service isn't publicly routed, so Traefik sees no requests for it."}
      format={count}
      kind="bar"
      points={analytics.trafficSeries.map((p) => ({ at: p.at, value: p.requests }))}
      title="Requests"
    />
    <AnalyticsChart
      bucketSeconds={analytics.bucketSeconds}
      format={(value) => ms(value)}
      points={analytics.trafficSeries.map((p) => ({
        at: p.at,
        value: p.avgResponseMs,
      }))}
      title="Avg response time"
    />
    <AnalyticsChart
      bucketSeconds={analytics.bucketSeconds}
      format={(value) => `${value.toFixed(1)}%`}
      points={analytics.resourceSeries.map((p) => ({
        at: p.at,
        value: p.cpuPercent,
      }))}
      title="CPU"
    />
    <AnalyticsChart
      bucketSeconds={analytics.bucketSeconds}
      format={mb}
      points={analytics.resourceSeries.map((p) => ({
        at: p.at,
        value: p.memUsedMb,
      }))}
      title="Memory"
    />
  </div>
</div>
