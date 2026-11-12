<script lang="ts">
	import { cn } from "@zedensix/ui/utils";

	import { clockLabel } from "#lib/chart-hover.js";
	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";
	import { type Lane, LANE_BUCKETS, laneBucketRange } from "#lib/lanes.js";
	import { formatCount, formatPercent } from "#lib/metrics-format.js";

	interface Props {
		class?: string;
		/** The share of a bucket's entries that have to be errors for it to turn red; 0 turns it red on any error. */
		errorShare?: number;
		/** CSS colour the traffic is drawn in, a stack's lane hue. */
		hue?: string;
		/** Unset while the lane is loading: draws an empty track. */
		lane?: Lane | null;
		/** What a bucket counts, singular: requests for traffic, lines for logs. */
		noun?: string;
		/** Where the hover tooltip opens. */
		placement?: "above" | "below";
		/** Draws a flat dashed line instead of traffic, for a stopped service. */
		stopped?: boolean;
	}

	const {
		class: className = "",
		errorShare = 0.25,
		hue = "var(--lane-0)",
		lane = null,
		noun = "request",
		placement = "above",
		stopped = false,
	}: Props = $props();

	const indexes = Array.from({ length: LANE_BUCKETS }, (_, i) => i);
	const busy = $derived((lane?.requests ?? []).filter((n) => n > 0));
	const high = $derived(Math.max(1, ...busy));
	const low = $derived(busy.length ? Math.min(...busy) : 0);
	const total = $derived(lane?.requests.reduce((sum, n) => sum + n, 0) ?? 0);
	const lastDeploy = $derived(lane?.deploys.at(-1));

	const hover = new ChartHover(() => (lane && !stopped ? LANE_BUCKETS : 0));
	const hovered = $derived.by(() => {
		if (!lane || hover.index === null) {
			return null;
		}
		const index = hover.index;
		return {
			deploys: lane.deploys.filter((deploy) => deploy.index === index),
			errors: lane.errors[index] ?? 0,
			index,
			range: laneBucketRange(lane.start, index),
			requests: lane.requests[index] ?? 0,
		};
	});

	function opacity(index: number): number {
		const requests = lane?.requests[index] ?? 0;
		if (!requests) {
			return 0.1;
		}
		if (high === low) {
			return 0.5;
		}
		return 0.22 + 0.72 * ((requests - low) / (high - low)) ** 0.8;
	}

	/** A bucket's opacity: its traffic share, dimmed while another bucket is hovered. */
	function shade(index: number): number {
		const base = failing(index) ? 0.9 : opacity(index);
		if (!hovered) {
			return base;
		}
		return hovered.index === index ? Math.max(base, 0.6) : base * 0.35;
	}

	function failing(index: number): boolean {
		const requests = lane?.requests[index] ?? 0;
		const errors = lane?.errors[index] ?? 0;
		return requests > 0 && errors > 0 && errors / requests >= errorShare;
	}
</script>

{#if stopped || !lane}
	<div
		class={cn("relative h-3.5 w-full", className)}
		aria-label="Last 24 hours"
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
					<span class="h-full flex-1 rounded-[2px] bg-(--lane-hue) opacity-10"
					></span>
				{/each}
			</div>
		{/if}
	</div>
{:else}
	<div
		class={cn("relative h-3.5 w-full", className)}
		aria-label="{total} {noun}s in the last 24 hours, {lane.deploys
			.length} deploys"
		onpointerdown={hover.track}
		onpointerleave={hover.clear}
		onpointermove={hover.track}
		role="img"
		style:--lane-hue={hue}
		bind:clientWidth={hover.width}
	>
		<div class="flex h-full gap-px">
			{#each indexes as i (i)}
				<span
					class="h-full flex-1 rounded-[2px] {failing(i)
						? 'bg-destructive'
						: 'bg-(--lane-hue)'} {hovered?.index === i
						? 'ring-text ring-1'
						: ''}"
					style:opacity={shade(i)}
				></span>
			{/each}
		</div>
		{#each lane.deploys as deploy, i (i)}
			<span
				class="pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rotate-45 border-[1.5px] {deploy.failed
					? 'border-destructive bg-destructive'
					: deploy === lastDeploy
						? 'border-text bg-text'
						: 'border-text bg-surface'}"
				style:left="{((deploy.index + 0.5) / LANE_BUCKETS) * 100}%"
			></span>
		{/each}
		{#if hovered}
			<ChartTooltip {placement} x={hover.x} y={placement === "above" ? 0 : 14}>
				<p class="opacity-75">
					{clockLabel(hovered.range.from)}–{clockLabel(hovered.range.to)}
				</p>
				<p>
					<b class="text-sm font-bold">{formatCount(hovered.requests)}</b>
					{hovered.requests === 1 ? noun : `${noun}s`}
				</p>
				{#if hovered.requests > 0}
					<p class="opacity-75">
						{formatCount(hovered.errors)} errors · {formatPercent(
							hovered.errors,
							hovered.requests,
							0,
						)}
					</p>
				{/if}
				{#each hovered.deploys as deploy (deploy.at)}
					<p>
						{deploy.failed ? "Failed deploy" : "Deploy"} at {clockLabel(
							deploy.at,
						)}
					</p>
				{/each}
			</ChartTooltip>
		{/if}
	</div>
{/if}
