<script lang="ts">
	import {
		type ActivityCluster,
		type ActivityEvent,
		activityLanes,
		activityTicks,
		type ActivityWindow,
	} from "#lib/activity-lanes.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";
	import type { ServiceEventLane } from "#lib/service-events.js";

	interface Props {
		events: ActivityEvent[];
		/** The period's name, as the Requests chart's picker shows it. */
		period: string;
		window: ActivityWindow;
	}

	const { events, period, window }: Props = $props();

	const HUES: Record<ServiceEventLane, string> = {
		config: "var(--chart-2)",
		deploys: "var(--chart-1)",
		lifecycle: "var(--chart-5)",
		networking: "var(--chart-3)",
		storage: "var(--chart-4)",
	};
	const LISTED = 5;

	const lanes = $derived(activityLanes(events, window));
	const total = $derived(
		lanes.reduce(
			(sum, lane) =>
				sum +
				lane.clusters.reduce(
					(count, cluster) => count + cluster.events.length,
					0,
				),
			0,
		),
	);
	const spanDays = $derived((window.to - window.from) / 86_400_000);
	const ticks = $derived(activityTicks(window));

	let active = $state<string | null>(null);

	/** A moment as the axis and tooltips show it: a time of day over a short period, a date past two days. */
	function when(at: number, withTime: boolean): string {
		if (spanDays <= 2) {
			return new Date(at).toLocaleTimeString(undefined, {
				hour: "2-digit",
				minute: "2-digit",
			});
		}
		return new Date(at).toLocaleString(undefined, {
			day: "numeric",
			month: "short",
			...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}),
		});
	}

	/** Shifts a tooltip inward near the card's edges, so it doesn't hang off them. */
	function nudge(position: number): number {
		if (position < 0.12) {
			return 72;
		}
		return position > 0.88 ? -72 : 0;
	}

	/** What a screen reader reads for a marker. */
	function describe(label: string, cluster: ActivityCluster): string {
		const latest = cluster.events.at(-1);
		return cluster.events.length === 1 && latest
			? `${label}: ${latest.summary}, ${when(latest.at, true)}`
			: `${label}: ${cluster.events.length} events, latest ${latest?.summary ?? ""}`;
	}
</script>

<section
	class="panel flex min-w-0 flex-col rounded-[1.125rem] px-5.5 pt-5 pb-4"
	data-slot="service-activity-lanes"
>
	<header class="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
		<h2 class="text-text text-[1.0625rem] font-[650] tracking-tight">
			Activity
		</h2>
		<span class="text-text-subtle ml-auto text-xs font-semibold">
			{total}
			{total === 1 ? "event" : "events"} · {period}
		</span>
	</header>

	<div
		class="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-2"
	>
		{#each lanes as lane (lane.id)}
			<span class="text-text-muted truncate text-xs font-semibold"
				>{lane.label}</span
			>
			<div class="relative h-6">
				<span
					class="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full"
					style="background: color-mix(in oklch, {HUES[
						lane.id
					]} 14%, transparent)"
				></span>
				{#each lane.clusters as cluster, index (index)}
					{@const key = `${lane.id}:${index}`}
					{@const count = cluster.events.length}
					<button
						class="text-surface absolute top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full text-[0.625rem] font-bold tabular-nums ring-2 ring-surface transition-transform outline-none hover:scale-110 focus-visible:scale-110 focus-visible:ring-(--ring) {count >
						1
							? 'h-4.5 min-w-4.5 px-1'
							: 'size-3'}"
						aria-label={describe(lane.label, cluster)}
						onblur={() => (active = null)}
						onclick={() => (active = key)}
						onfocus={() => (active = key)}
						onpointerenter={() => (active = key)}
						onpointerleave={(event) => {
							if (event.pointerType === "mouse") {
								active = null;
							}
						}}
						style="left: {cluster.position * 100}%; background: {cluster.failed
							? 'var(--destructive)'
							: HUES[lane.id]}"
						type="button"
					>
						{#if count > 1}{count}{/if}
					</button>
					{#if active === key}
						<span
							class="absolute top-0"
							style="left: {cluster.position * 100}%"
						>
							<ChartTooltip x={nudge(cluster.position)} y={0}>
								{#each cluster.events.slice(-LISTED) as event, e (e)}
									<div class={e > 0 ? "mt-1.5" : ""}>
										<p class="opacity-75">
											{when(event.at, true)} · {event.actor ?? "Homerun"}
										</p>
										<p class="max-w-80 truncate">
											<b class="text-sm font-bold">{event.summary}</b>
										</p>
										{#if count === 1}
											{#each event.detail.slice(0, 4) as line (line)}
												<p class="max-w-80 truncate opacity-75">{line}</p>
											{/each}
											{#if event.detail.length > 4}
												<p class="opacity-75">
													and {event.detail.length - 4} more
												</p>
											{/if}
										{/if}
									</div>
								{/each}
								{#if count > LISTED}
									<p class="mt-1.5 opacity-75">
										and {count - LISTED} earlier
									</p>
								{/if}
							</ChartTooltip>
						</span>
					{/if}
				{/each}
			</div>
		{/each}
		<span></span>
		<div
			class="text-text-subtle flex justify-between text-[0.72rem] font-semibold tabular-nums"
		>
			{#each ticks as tick, i (i)}
				<span>{i === ticks.length - 1 ? "now" : when(tick, false)}</span>
			{/each}
		</div>
	</div>
</section>
