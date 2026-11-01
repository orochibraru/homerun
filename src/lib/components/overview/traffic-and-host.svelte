<script lang="ts">
	import { resolve } from "$app/paths";
	import { ArrowRight } from "@lucide/svelte";

	import ErrorBoundary from "#lib/components/error-boundary.svelte";
	import HostResources from "#lib/components/host-resources.svelte";
	import MetricChart from "#lib/components/monitoring/metric-chart.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { formatCount as count } from "#lib/metrics-format.js";
	import type { MonitoringSummary } from "#lib/services/monitoring.service.js";

	interface Props {
		/** The today's monitoring query failed. */
		failed: boolean;
		/** Today's monitoring, unset while it loads. */
		monitoring: { monitoring: MonitoringSummary } | undefined;
	}

	const { failed, monitoring }: Props = $props();
</script>

<div
	class="mb-10 grid grid-cols-1 gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
>
	<section>
		<header class="mb-2 flex items-baseline gap-2">
			<h2 class="text-text text-sm font-semibold">Traffic today</h2>
			<a
				class="text-accent ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
				href={resolve("monitoring")}
			>
				Monitoring <ArrowRight class="size-3" />
			</a>
		</header>
		{#if monitoring}
			<MetricChart
				bucketSeconds={monitoring.monitoring.bucketSeconds}
				format={count}
				plain
				points={monitoring.monitoring.trafficSeries.map((point) => ({
					at: point.at,
					value: point.requests,
				}))}
				title="Requests"
			/>
		{:else if failed}
			<p class="text-text-muted py-6 text-sm">Couldn't load today's traffic.</p>
		{:else}
			<Skeleton class="h-48 w-full" />
		{/if}
	</section>
	<section>
		<header class="mb-2 flex items-baseline gap-2">
			<h2 class="text-text text-sm font-semibold">Host</h2>
		</header>
		<ErrorBoundary title="Host resources didn't load.">
			<HostResources />
		</ErrorBoundary>
	</section>
</div>
