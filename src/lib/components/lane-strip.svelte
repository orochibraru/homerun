<script lang="ts">
	import { cn } from "@orochibraru/ui/utils";

	import { type Lane, LANE_BUCKETS } from "#lib/lanes.js";

	interface Props {
		class?: string;
		/** CSS colour the traffic is drawn in, a stack's lane hue. */
		hue?: string;
		/** Unset while the lane is loading: draws an empty track. */
		lane?: Lane | null;
		/** Draws a flat dashed line instead of traffic, for a stopped service. */
		stopped?: boolean;
	}

	const {
		class: className = "",
		hue = "var(--lane-0)",
		lane = null,
		stopped = false,
	}: Props = $props();

	const indexes = Array.from({ length: LANE_BUCKETS }, (_, i) => i);
	const peak = $derived(Math.max(1, ...(lane?.requests ?? [0])));
	const total = $derived(lane?.requests.reduce((sum, n) => sum + n, 0) ?? 0);
	const lastDeploy = $derived(lane?.deploys.at(-1));

	function opacity(index: number): number {
		const requests = lane?.requests[index] ?? 0;
		if (!requests) {
			return 0.07;
		}
		return 0.16 + 0.76 * Math.sqrt(requests / peak);
	}

	function failing(index: number): boolean {
		const requests = lane?.requests[index] ?? 0;
		const errors = lane?.errors[index] ?? 0;
		return requests > 0 && errors / requests >= 0.25;
	}
</script>

<div
	class={cn("relative h-3.5 w-full", className)}
	aria-label={lane
		? `${total} requests in the last 24 hours, ${lane.deploys.length} deploys`
		: "Last 24 hours"}
	role="img"
	style:--lane-hue={hue}
>
	{#if stopped}
		<span
			class="border-text-subtle/50 absolute inset-x-0 top-1/2 border-t border-dashed"
		></span>
	{:else}
		<div class="flex h-full gap-px">
			{#each indexes as i (i)}
				<span
					class="h-full flex-1 rounded-[2px] {failing(i)
						? 'bg-red-500'
						: 'bg-(--lane-hue)'}"
					style:opacity={failing(i) ? 0.9 : opacity(i)}
				></span>
			{/each}
		</div>
		{#each lane?.deploys ?? [] as deploy, i (i)}
			<span
				class="absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-[1.5px] {deploy.failed
					? 'border-red-500 bg-red-500'
					: deploy === lastDeploy
						? 'border-text bg-text'
						: 'border-text bg-surface'}"
				style:left="{((deploy.index + 0.5) / LANE_BUCKETS) * 100}%"
			></span>
		{/each}
	{/if}
</div>
