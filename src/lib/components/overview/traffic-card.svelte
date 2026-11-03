<script lang="ts">
	import { resolve } from "$app/paths";
	import { ChevronRight } from "@lucide/svelte";

	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { formatCount, formatPercent } from "#lib/metrics-format.js";
	import type { MonitoringSummary } from "#lib/services/monitoring.service.js";

	interface Props {
		/** Today's monitoring couldn't be loaded. */
		failed: boolean;
		/** Today's monitoring, unset while it loads. */
		monitoring: MonitoringSummary | undefined;
	}

	const { failed, monitoring }: Props = $props();

	const SLOT_HOURS = 2;
	const SLOT_MS = SLOT_HOURS * 60 * 60 * 1000;
	const SLOTS = 24 / SLOT_HOURS;
	const TICKS = 4;

	const hatched =
		"background-color: var(--bar-fill); background-image: repeating-linear-gradient(135deg, transparent 0 7px, var(--bar-stripe) 7px 8px)";
	const highlighted =
		"background: linear-gradient(180deg, var(--primary), color-mix(in oklch, var(--primary), black 35%)); box-shadow: 0 10px 24px -10px color-mix(in oklch, var(--primary) 55%, transparent)";

	/** The smallest round axis top (a multiple of `TICKS` steps of 1, 2, 2.5, 3 or 5 × 10ⁿ) at or above `value`. */
	function axisTop(value: number): number {
		const step = value / TICKS;
		if (step <= 1) {
			return TICKS;
		}
		const magnitude = 10 ** Math.floor(Math.log10(step));
		const nice =
			[1, 2, 2.5, 3, 5, 10].find((factor) => factor * magnitude >= step) ?? 10;
		return nice * magnitude * TICKS;
	}

	/** An hour of the day as `HH:00`. */
	function clock(hour: number): string {
		return `${String(hour % 24).padStart(2, "0")}:00`;
	}

	const slots = $derived.by(() => {
		if (!monitoring?.since) {
			return [];
		}
		const start = new Date(monitoring.since).getTime();
		const current = Math.floor((Date.now() - start) / SLOT_MS);
		const values = Array.from({ length: SLOTS }, () => 0);
		const errors = Array.from({ length: SLOTS }, () => 0);
		for (const point of monitoring.trafficSeries) {
			const index = Math.floor(
				(new Date(point.at).getTime() - start) / SLOT_MS,
			);
			if (index >= 0 && index < SLOTS) {
				values[index] += point.requests;
				errors[index] += point.errors;
			}
		}
		return values.map((value, index) => ({
			errors: errors[index],
			future: index > current,
			hour: index * SLOT_HOURS,
			value,
		}));
	});
	const peak = $derived(
		slots.reduce<{ hour: number; value: number } | null>(
			(best, slot) =>
				slot.value > 0 && (!best || slot.value > best.value) ? slot : best,
			null,
		),
	);
	const top = $derived(axisTop(peak?.value ?? 0));
	const ticks = $derived(
		Array.from({ length: TICKS + 1 }, (_, index) => (top / TICKS) * index),
	);

	const hover = new ChartHover(() => slots.length);
	const hoveredSlot = $derived(
		hover.index === null ? null : (slots[hover.index] ?? null),
	);

	/** A value's height as a share of the plot. */
	function share(value: number): number {
		return (value / top) * 100;
	}
</script>

<section class="panel flex min-w-0 flex-col rounded-2xl px-5.5 pt-5 pb-4">
	<header class="flex flex-wrap items-center gap-3">
		<h2 class="text-[1.0625rem] font-semibold tracking-tight">Traffic</h2>
		<a
			class="border-border-light bg-surface text-text-muted hover:text-text inline-flex h-7.5 items-center gap-1 rounded-full border pr-2 pl-3 text-xs font-semibold transition-colors"
			href={resolve("monitoring")}
			title="Open Monitoring"
		>
			Today <ChevronRight class="size-3.5" />
		</a>
		{#if peak}
			<p class="ml-auto flex items-baseline gap-1.5">
				<span class="text-2xl font-medium tracking-[-0.03em] tabular-nums"
					>{formatCount(peak.value)}</span
				>
				<span class="text-text-subtle text-xs"
					>requests at peak, {clock(peak.hour)}–{clock(
						peak.hour + SLOT_HOURS,
					)}</span
				>
			</p>
		{/if}
	</header>

	{#if !monitoring}
		{#if failed}
			<p class="text-text-muted py-16 text-center text-sm">
				Couldn't load today's traffic.
			</p>
		{:else}
			<Skeleton class="mt-4 h-64 w-full rounded-xl md:h-82.5" />
		{/if}
	{:else}
		<div
			class="mt-4 grid h-64 grid-cols-[2.25rem_minmax(0,1fr)] md:h-82.5"
			aria-label="Requests per two hours today"
			role="group"
		>
			<div class="relative mb-7">
				{#each ticks as tick (tick)}
					<span
						class="text-text-subtle absolute left-0 translate-y-1/2 text-[0.6875rem] tabular-nums"
						style="bottom: {share(tick)}%">{formatCount(tick)}</span
					>
				{/each}
			</div>
			<div
				class="relative rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
				aria-label="Requests per two hours: use the arrow keys to read each bar"
				onblur={hover.clear}
				onkeydown={hover.key}
				onpointerdown={hover.track}
				onpointerleave={hover.leave}
				onpointermove={hover.track}
				role="slider"
				aria-valuemax={SLOTS - 1}
				aria-valuemin={0}
				aria-valuenow={hover.index ?? 0}
				aria-valuetext={hoveredSlot
					? `${clock(hoveredSlot.hour)} to ${clock(hoveredSlot.hour + SLOT_HOURS)}: ${hoveredSlot.value} requests`
					: undefined}
				tabindex="0"
				bind:clientWidth={hover.width}
			>
				<div class="absolute inset-x-0 top-0 bottom-7">
					{#if peak}
						<div
							class="absolute inset-x-0 border-t-[1.5px] border-dashed"
							style="bottom: {share(
								peak.value,
							)}%; border-color: color-mix(in oklch, var(--primary) 55%, transparent)"
						>
							<span
								class="bg-primary text-primary-foreground absolute -top-2.75 -left-0.5 rounded-full px-2 py-0.5 text-[0.625rem] font-bold"
								>peak</span
							>
						</div>
					{:else}
						<p
							class="text-text-muted absolute inset-0 grid place-items-center text-sm"
						>
							No traffic recorded yet today.
						</p>
					{/if}
				</div>
				<div class="absolute inset-0 grid grid-cols-12 gap-1.5 sm:gap-2">
					{#each slots as slot (slot.hour)}
						{@const isPeak = slot.hour === peak?.hour}
						{@const dimmed =
							hoveredSlot !== null && hoveredSlot.hour !== slot.hour}
						<div
							class="relative flex min-w-0 flex-col items-center transition-opacity {dimmed
								? 'opacity-40'
								: ''}"
						>
							<div class="relative w-full flex-1">
								{#if !slot.future && slot.value > 0}
									<div
										class="absolute inset-x-0 bottom-0 min-h-1.5 rounded-[min(0.75rem,30%)]"
										style="height: {share(slot.value)}%; {isPeak
											? highlighted
											: hatched}"
									></div>
									<span
										class="absolute left-1/2 -translate-x-1/2 rounded-full px-2.25 py-1 text-[0.6875rem] font-bold whitespace-nowrap tabular-nums {isPeak
											? 'bg-primary text-primary-foreground'
											: 'bg-surface ring-border-light hidden shadow-sm ring-1 2xl:block'}"
										style="bottom: calc({share(slot.value)}% + 0.5rem)"
										>{formatCount(slot.value)}</span
									>
								{/if}
							</div>
							<span
								class="flex h-7 items-end text-[0.6875rem] tabular-nums {isPeak
									? 'text-accent font-bold'
									: 'text-text-subtle font-semibold'}"
								><span class="hidden sm:inline">{clock(slot.hour)}</span><span
									class="sm:hidden">{slot.hour}</span
								></span
							>
						</div>
					{/each}
				</div>
				{#if hoveredSlot}
					<ChartTooltip placement="below" x={hover.x} y={0}>
						<p class="opacity-75">
							{clock(hoveredSlot.hour)}–{clock(hoveredSlot.hour + SLOT_HOURS)}
						</p>
						{#if hoveredSlot.future}
							<p>Not yet</p>
						{:else}
							<p>
								<b class="text-sm font-bold">{formatCount(hoveredSlot.value)}</b
								>
								{hoveredSlot.value === 1 ? "request" : "requests"}
							</p>
							{#if hoveredSlot.value > 0}
								<p class="opacity-75">
									{formatCount(hoveredSlot.errors)} errors · {formatPercent(
										hoveredSlot.errors,
										hoveredSlot.value,
										0,
									)}
								</p>
							{/if}
						{/if}
					</ChartTooltip>
				{/if}
			</div>
		</div>
	{/if}
</section>
