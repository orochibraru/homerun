<script lang="ts">
	import { goto, refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { Cpu, MemoryStick, Timer, TrendingUp } from "@lucide/svelte";
	import * as Select from "@zedensix/ui/select";
	import { type Component, onMount } from "svelte";

	import { clampX, entryX } from "#lib/chart-hover.js";
	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";
	import {
		formatCount,
		formatMb,
		formatMs,
		formatPercent,
	} from "#lib/metrics-format.js";
	import { MONITORING_RANGES } from "#lib/monitoring-ranges.js";
	import type { MonitoringSummary } from "#lib/services/monitoring.service.js";

	interface Props {
		monitoring: MonitoringSummary;
		zone: string;
	}

	const { monitoring, zone }: Props = $props();

	type Metric = "cpu" | "latency" | "memory" | "requests";

	const METRICS: { icon: Component; id: Metric; label: string }[] = [
		{ icon: TrendingUp, id: "requests", label: "Requests" },
		{ icon: Timer, id: "latency", label: "Latency" },
		{ icon: Cpu, id: "cpu", label: "CPU" },
		{ icon: MemoryStick, id: "memory", label: "Memory" },
	];

	const FORMATS: Record<Metric, (value: number) => string> = {
		cpu: (value) => `${value.toFixed(1)}%`,
		latency: (value) => formatMs(value),
		memory: (value) => formatMb(value),
		requests: (value) => `${formatCount(Math.round(value))} req`,
	};

	const WIDTH = 1000;
	const HEIGHT = 220;

	const uid = $props.id();

	let metric = $state<Metric>("requests");

	onMount(() => {
		const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
		if (browserZone && browserZone !== zone) {
			document.cookie = `tz=${encodeURIComponent(browserZone)}; path=/; max-age=31536000; samesite=lax`;
			void refreshAll();
		}
	});

	const points = $derived(
		metric === "requests" || metric === "latency"
			? monitoring.trafficSeries.map((point) => ({
					at: new Date(point.at),
					details: [
						metric === "requests"
							? `${formatMs(point.avgResponseMs)} avg`
							: `${formatCount(point.requests)} req`,
						point.requests > 0
							? `${formatCount(point.errors)} errors · ${formatPercent(point.errors, point.requests, 0)}`
							: "",
					].filter(Boolean),
					value: metric === "requests" ? point.requests : point.avgResponseMs,
				}))
			: monitoring.resourceSeries.map((point) => ({
					at: new Date(point.at),
					details:
						metric === "cpu"
							? [
									point.memUsedMb === null
										? "No memory sample"
										: `${formatMb(point.memUsedMb)} memory`,
								]
							: [
									point.cpuPercent === null
										? "No CPU sample"
										: `${point.cpuPercent.toFixed(1)}% CPU`,
								],
					value: metric === "cpu" ? point.cpuPercent : point.memUsedMb,
				})),
	);

	const hover = new ChartHover(() => points.length, true);
	const hovered = $derived(hover.index);

	const defined = $derived(
		points.flatMap((point, index) =>
			point.value === null ? [] : [{ index, value: point.value }],
		),
	);

	const peak = $derived(Math.max(0, ...defined.map((point) => point.value)));
	const empty = $derived(peak === 0);

	function x(index: number): number {
		return points.length <= 1
			? WIDTH / 2
			: (index / (points.length - 1)) * WIDTH;
	}

	function y(value: number): number {
		return HEIGHT - (value / (peak * 1.15 || 1)) * HEIGHT;
	}

	const line = $derived.by(() => {
		const coords = defined.map((point) => [x(point.index), y(point.value)]);
		if (coords.length === 0) {
			return "";
		}
		let path = `M${coords[0][0]},${coords[0][1]}`;
		for (let i = 1; i < coords.length; i += 1) {
			const [x0, y0] = coords[i - 1];
			const [x1, y1] = coords[i];
			const mid = (x0 + x1) / 2;
			path += ` C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
		}
		return path;
	});

	const area = $derived(
		defined.length
			? `${line} L${x(defined.at(-1)?.index ?? 0)},${HEIGHT} L${x(defined[0].index)},${HEIGHT}Z`
			: "",
	);

	const peakIndex = $derived(
		defined.reduce(
			(best, point) => (point.value > best.value ? point : best),
			defined[0] ?? { index: 0, value: 0 },
		).index,
	);

	const shownIndex = $derived(hovered ?? peakIndex);
	const shown = $derived(points[shownIndex]);

	const spanDays = $derived(monitoring.spanSeconds / 86_400);

	function when(at: Date, withTime: boolean): string {
		if (spanDays <= 2) {
			return at.toLocaleTimeString(undefined, {
				hour: "2-digit",
				minute: "2-digit",
			});
		}
		return at.toLocaleString(undefined, {
			day: "numeric",
			month: "short",
			...(withTime && monitoring.bucketSeconds < 86_400
				? { hour: "2-digit", minute: "2-digit" }
				: {}),
		});
	}

	const ticks = $derived(
		points.length < 2
			? []
			: Array.from({ length: 7 }, (_, i) =>
					i === 6
						? "now"
						: when(points[Math.round((i * (points.length - 1)) / 6)].at, false),
				),
	);

	function rangeHref(range: string): string {
		const url = new URL(page.url.href);
		url.searchParams.set("range", range);
		return `${url.pathname}${url.search}`;
	}
</script>

<section
	class="panel flex min-w-0 flex-col rounded-[1.125rem] px-5.5 pt-5 pb-4"
>
	<div class="mb-4.5 flex flex-wrap items-center gap-x-3.5 gap-y-2">
		<h2 class="text-text text-[1.0625rem] font-[650] tracking-tight">
			{METRICS.find((entry) => entry.id === metric)?.label}
		</h2>
		<div
			class="bg-surface ring-border inline-flex rounded-full p-0.5 ring-1"
			aria-label="Metric"
			role="group"
		>
			{#each METRICS as entry (entry.id)}
				<button
					class="inline-flex h-6.5 items-center gap-1.5 rounded-full px-3.5 text-[0.78rem] font-semibold transition-colors {metric ===
					entry.id
						? 'bg-primary text-primary-foreground'
						: 'text-text-muted hover:text-text'}"
					aria-pressed={metric === entry.id}
					onclick={() => {
						metric = entry.id;
						hover.clear();
					}}
					type="button"
				>
					<entry.icon class="size-3.5 shrink-0" />
					{entry.label}
				</button>
			{/each}
		</div>
		<Select.Root
			onValueChange={(range) => void goto(rangeHref(range), { reset: false })}
			type="single"
			value={monitoring.range}
		>
			<Select.Trigger
				class="text-text-muted ml-auto h-7.5! rounded-full! py-0 pr-2.5 pl-3 text-[0.78rem] font-semibold"
				aria-label="Period"
			>
				{MONITORING_RANGES.find((range) => range.id === monitoring.range)
					?.label}
			</Select.Trigger>
			<Select.Content align="end">
				{#each MONITORING_RANGES as range (range.id)}
					<Select.Item label={range.label} value={range.id} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div
		class="relative h-55 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
		aria-label="{METRICS.find((entry) => entry.id === metric)
			?.label} over the period: use the arrow keys to read each point"
		aria-valuemax={Math.max(points.length - 1, 0)}
		aria-valuemin={0}
		aria-valuenow={shownIndex}
		aria-valuetext={shown
			? `${when(shown.at, true)}: ${shown.value === null ? "no data" : FORMATS[metric](shown.value)}`
			: undefined}
		onblur={hover.clear}
		onkeydown={hover.key}
		onpointerdown={hover.track}
		onpointerleave={hover.leave}
		onpointermove={hover.track}
		role="slider"
		tabindex="0"
		bind:clientWidth={hover.width}
	>
		<svg
			class="block size-full overflow-visible"
			aria-hidden="true"
			preserveAspectRatio="none"
			viewBox="0 0 {WIDTH} {HEIGHT}"
		>
			<defs>
				<linearGradient id="{uid}-fill" x1="0" x2="0" y1="0" y2="1">
					<stop
						offset="0"
						style="stop-color: var(--primary); stop-opacity: 0.28"
					/>
					<stop
						offset="1"
						style="stop-color: var(--primary); stop-opacity: 0"
					/>
				</linearGradient>
			</defs>
			{#each [0.25, 0.5, 0.75] as fraction (fraction)}
				<line
					stroke="var(--color-border)"
					stroke-dasharray="4 6"
					vector-effect="non-scaling-stroke"
					x1="0"
					x2={WIDTH}
					y1={HEIGHT * fraction}
					y2={HEIGHT * fraction}
				/>
			{/each}
			{#if !empty}
				<path d={area} fill="url(#{uid}-fill)" />
				<path
					d={line}
					fill="none"
					stroke="var(--primary)"
					stroke-linecap="round"
					stroke-width="2.25"
					vector-effect="non-scaling-stroke"
				/>
				{#if hovered !== null}
					<line
						stroke="var(--color-border)"
						stroke-width="1"
						vector-effect="non-scaling-stroke"
						x1={x(shownIndex)}
						x2={x(shownIndex)}
						y1="0"
						y2={HEIGHT}
					/>
				{/if}
				{#if shown?.value !== null && shown?.value !== undefined}
					<line
						stroke="var(--primary)"
						stroke-dasharray="3 4"
						stroke-width="1.5"
						vector-effect="non-scaling-stroke"
						x1={x(shownIndex)}
						x2={x(shownIndex)}
						y1={y(shown.value)}
						y2={HEIGHT}
					/>
				{/if}
			{/if}
		</svg>
		{#if empty}
			<p
				class="text-text-subtle absolute inset-0 grid place-items-center text-sm"
			>
				Nothing recorded in this period yet.
			</p>
		{:else if shown}
			{@const left = (x(shownIndex) / WIDTH) * 100}
			{#if shown.value !== null}
				<span
					class="bg-surface pointer-events-none absolute -mt-1.75 -ml-1.75 size-3.5 rounded-full shadow-[0_0_0_3.5px_var(--primary),0_4px_10px_-2px_var(--primary)]"
					style="left: {left}%; top: {y(shown.value)}px"
				></span>
			{/if}
			<ChartTooltip
				x={clampX(
					entryX(shownIndex, points.length, hover.width, true),
					hover.width,
				)}
				y={Math.max(shown.value === null ? 40 : y(shown.value), 40)}
			>
				<p class="opacity-75">
					{hovered === null ? "Peak · " : ""}{when(shown.at, true)}
				</p>
				<p>
					<b class="text-sm font-bold"
						>{shown.value === null
							? "No data"
							: FORMATS[metric](shown.value)}</b
					>
				</p>
				{#if hovered !== null}
					{#each shown.details as detail (detail)}
						<p class="opacity-75">{detail}</p>
					{/each}
				{/if}
			</ChartTooltip>
		{/if}
	</div>
	<div
		class="text-text-subtle mt-2.5 flex justify-between text-[0.72rem] font-semibold tabular-nums"
	>
		{#each ticks as tick, i (i)}
			<span>{tick}</span>
		{/each}
	</div>
</section>
