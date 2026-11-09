<script lang="ts">
	import { BarChart3 } from "@lucide/svelte";

	import LaneStrip from "#lib/components/lane-strip.svelte";
	import { formatCount } from "#lib/metrics-format.js";
	import { getLogLane } from "#lib/remote/lanes.remote.js";

	const { serviceId }: { serviceId: string } = $props();

	const query = $derived(getLogLane(serviceId));
	const lane = $derived(query.current ?? null);
	const lines = $derived(lane?.requests.reduce((sum, n) => sum + n, 0) ?? 0);
	const errors = $derived(lane?.errors.reduce((sum, n) => sum + n, 0) ?? 0);
</script>

<section class="panel mb-3 rounded-md px-5 py-4" data-slot="log-volume">
	<div class="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1">
		<BarChart3 class="text-text-muted size-4" />
		<h2 class="eyebrow">Log volume</h2>
		<span class="text-text-subtle ml-auto text-xs font-semibold tabular-nums">
			{#if query.error}
				Couldn't load the volume
			{:else if lane}
				{formatCount(lines)}
				{lines === 1 ? "line" : "lines"}{#if errors > 0}
					·
					<span class="text-destructive"
						>{formatCount(errors)} {errors === 1 ? "error" : "errors"}</span
					>{/if} · last 24 hours
			{:else}
				Last 24 hours
			{/if}
		</span>
	</div>
	<LaneStrip errorShare={0} {lane} noun="line" placement="below" />
	<div
		class="text-text-subtle mt-1.5 flex justify-between text-[0.72rem] font-semibold"
	>
		<span>24h ago</span>
		<span>now</span>
	</div>
</section>
