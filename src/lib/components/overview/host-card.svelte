<script lang="ts">
	import { onMount } from "svelte";

	import ChartHoverTarget from "#lib/components/chart-hover-target.svelte";
	import ResourceInsightsDialog from "#lib/components/resource-insights-dialog.svelte";
	import RingGauge from "#lib/components/ring-gauge.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { getSystemStats } from "#lib/remote/system-stats.remote.js";
	import type { InsightResource } from "#lib/services/resource-insights.service.js";

	const POLL_MS = 5000;

	const stats = getSystemStats();

	let insightOpen = $state(false);
	let insightResource = $state<InsightResource>("cpu");

	function showInsight(resource: InsightResource | null) {
		if (resource) {
			insightResource = resource;
			insightOpen = true;
		}
	}

	onMount(() => {
		const timer = setInterval(() => {
			void stats.refresh();
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	/** `used` as a percentage of `total`, clamped to 0–100. */
	function percent(used: number, total: number): number {
		return total > 0 ? Math.max(0, Math.min(100, (used / total) * 100)) : 0;
	}

	/** Gigabytes with one decimal under a hundred, whole past it. */
	function gigabytes(value: number): string {
		return value >= 100 ? value.toFixed(0) : value.toFixed(1);
	}

	const host = $derived(stats.current);
	interface Ring {
		detail: string;
		label: string;
		percent: number;
		resource: InsightResource | null;
		usage: string;
	}

	const rings = $derived.by((): Ring[] => {
		if (!host) {
			return [];
		}
		const memoryGb = host.memUsedMb / 1024;
		return [
			{
				detail: "all cores",
				label: "CPU",
				resource: "cpu",
				percent: host.cpuPercent,
				usage: `${host.cpuPercent.toFixed(1)}% across all cores`,
			},
			{
				detail: `${gigabytes(memoryGb)} GB`,
				label: "Memory",
				resource: "memory",
				percent: percent(host.memUsedMb, host.memTotalMb),
				usage: `${gigabytes(memoryGb)} of ${gigabytes(host.memTotalMb / 1024)} GB used`,
			},
			...(host.diskUsedGb !== null && host.diskTotalGb !== null
				? [
						{
							detail: `${gigabytes(host.diskUsedGb)} GB`,
							label: "Disk",
							resource: "disk" as const,
							percent: percent(host.diskUsedGb, host.diskTotalGb),
							usage: `${gigabytes(host.diskUsedGb)} of ${gigabytes(host.diskTotalGb)} GB used`,
						},
					]
				: []),
			...(host.gpu
				? [
						{
							detail: host.gpu.name,
							label: "GPU",
							resource: null,
							percent: host.gpu.utilizationPercent,
							usage: `${host.gpu.utilizationPercent}% busy · ${gigabytes(host.gpu.memUsedMb / 1024)} of ${gigabytes(host.gpu.memTotalMb / 1024)} GB memory`,
						},
					]
				: []),
		];
	});
</script>

<section class="panel rounded-2xl px-4.5 py-5" data-slot="host-resources">
	<header class="flex items-baseline gap-3">
		<h2 class="text-[1.0625rem] font-semibold tracking-tight">Host</h2>
		{#if host}
			<span class="text-text-subtle ml-auto truncate text-xs font-semibold">
				{gigabytes(host.memTotalMb / 1024)} GB memory{host.diskTotalGb !== null
					? ` · ${gigabytes(host.diskTotalGb)} GB disk`
					: ""}
			</span>
		{/if}
	</header>
	{#if stats.error && !host}
		<p class="text-text-muted mt-4 text-sm">
			Host resource stats are unavailable right now.
		</p>
	{:else if !host}
		<div class="mt-4 grid grid-cols-3 gap-2">
			<Skeleton class="h-32 rounded-xl" />
			<Skeleton class="h-32 rounded-xl" />
			<Skeleton class="h-32 rounded-xl" />
		</div>
	{:else}
		<div
			class="mt-4 grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-2"
		>
			{#each rings as ring (ring.label)}
				<ChartHoverTarget
					class="bg-surface-2 flex min-w-0 flex-col items-center rounded-xl px-1.5 pt-3.5 pb-3"
					label="{ring.label}: {ring.usage}{ring.resource
						? ', open to see what uses it'
						: ''}"
					onselect={ring.resource
						? () => showInsight(ring.resource)
						: undefined}
				>
					{#snippet tip()}
						<p class="opacity-75">{ring.label}</p>
						<p><b class="text-sm font-bold">{ring.percent.toFixed(1)}%</b></p>
						<p class="opacity-75">{ring.usage}</p>
						{#if ring.resource}
							<p class="opacity-75">Click to see what uses it</p>
						{/if}
					{/snippet}
					<RingGauge percent={ring.percent}>
						<span
							class="text-[0.9375rem] font-semibold tracking-[-0.03em] tabular-nums"
							>{ring.percent.toFixed(0)}%</span
						>
					</RingGauge>
					<p class="mt-2 text-[0.8125rem] font-bold">{ring.label}</p>
					<p class="text-text-subtle max-w-full truncate text-[0.6875rem]">
						{ring.detail}
					</p>
				</ChartHoverTarget>
			{/each}
		</div>
	{/if}
</section>

<ResourceInsightsDialog resource={insightResource} bind:open={insightOpen} />
