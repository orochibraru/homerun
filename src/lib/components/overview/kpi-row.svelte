<script lang="ts">
	import { Bug, Gauge, Server, TrendingUp } from "@lucide/svelte";

	import KpiTile from "#lib/components/kpi-tile.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import {
		type Change,
		formatCount,
		formatMs,
		formatPercent,
	} from "#lib/metrics-format.js";
	import { monitoringChanges } from "#lib/monitoring-changes.js";
	import type { MonitoringSummary } from "#lib/services/monitoring.service.js";

	interface Props {
		/** Today's monitoring couldn't be loaded. */
		failed: boolean;
		/** Today's monitoring, unset while it loads. */
		monitoring: MonitoringSummary | undefined;
		/** How many services are running out of how many, unset while it loads. */
		stats: { running: number; totalServices: number } | undefined;
	}

	const { failed, monitoring, stats }: Props = $props();

	const traffic = $derived(monitoring?.traffic);
	const changes = $derived(monitoring ? monitoringChanges(monitoring) : {});

	/** A formatted reading split into its number and its unit (`235.9K` → `235.9` and `K`). */
	function reading(text: string): { unit?: string; value: string } {
		const match = text.match(/^([^A-Za-z%]+?)\s*([A-Za-z%]+)$/);
		return match ? { unit: match[2], value: match[1] } : { value: text };
	}

	/** A change as the tile's delta pill: an arrow for its direction, green unless it's bad news. */
	function delta(
		change: Change | null | undefined,
	): { good: boolean; text: string } | undefined {
		if (!change) {
			return undefined;
		}
		const arrow = change.text.startsWith("+")
			? "↑"
			: change.text.startsWith("−")
				? "↓"
				: "";
		return {
			good: change.direction !== "worse",
			text: `${arrow} ${change.text.slice(1)}`.trim(),
		};
	}

	const requests = $derived(
		reading(traffic ? formatCount(traffic.requests) : "—"),
	);
	const latency = $derived(
		reading(traffic ? formatMs(traffic.avgResponseMs) : "—"),
	);
	const errorRate = $derived(
		reading(
			traffic
				? formatPercent(traffic.status4xx + traffic.status5xx, traffic.requests)
				: "—",
		),
	);
</script>

<div class="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
	{#if stats}
		<KpiTile
			icon={Server}
			label="Services up"
			tone="hero"
			value="{stats.running} / {stats.totalServices}"
		/>
	{:else}
		<Skeleton class="h-21 rounded-2xl" />
	{/if}
	{#if traffic || failed}
		<KpiTile
			delta={delta(changes.requests)}
			icon={TrendingUp}
			label="Requests today"
			tone="sand"
			unit={requests.unit}
			value={requests.value}
		/>
		<KpiTile
			delta={delta(changes.avgResponse)}
			icon={Gauge}
			label="Avg latency"
			tone="mauve"
			unit={latency.unit}
			value={latency.value}
		/>
		<KpiTile
			delta={delta(changes.errorRate)}
			icon={Bug}
			label="Error rate"
			tone="sky"
			unit={errorRate.unit}
			value={errorRate.value}
		/>
	{:else}
		<Skeleton class="h-21 rounded-2xl" />
		<Skeleton class="h-21 rounded-2xl" />
		<Skeleton class="h-21 rounded-2xl" />
	{/if}
</div>
