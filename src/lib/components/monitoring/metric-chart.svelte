<script lang="ts">
	import { clampX, entryX } from "#lib/chart-hover.js";
	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";

	interface Point {
		at: Date;
		value: number | null;
	}

	interface Props {
		bucketSeconds: number;
		format: (value: number) => string;
		kind?: "bar" | "line";
		points: Point[];
		title: string;
		empty?: string;
		/** Drops the chart's own panel, for a chart that sits inside another one. */
		plain?: boolean;
	}

	const {
		bucketSeconds,
		format,
		kind = "line",
		points,
		title,
		empty = "Nothing recorded in this range yet.",
		plain = false,
	}: Props = $props();

	const hover = new ChartHover(() => points.length);
	const hovered = $derived(hover.index);

	const values = $derived(points.map((point) => point.value ?? 0));
	const peak = $derived(Math.max(...values, 0) || 1);
	const average = $derived(
		values.length
			? values.reduce((sum, value) => sum + value, 0) / values.length
			: 0,
	);

	function x(index: number): number {
		return points.length <= 1 ? 50 : (index / (points.length - 1)) * 100;
	}

	function y(value: number): number {
		return 40 - (value / peak) * 36;
	}

	const line = $derived(
		points
			.map((point, index) =>
				point.value === null
					? null
					: `${x(index).toFixed(2)},${y(point.value).toFixed(2)}`,
			)
			.filter(Boolean)
			.join(" "),
	);

	function when(at: Date): string {
		const options: Intl.DateTimeFormatOptions =
			bucketSeconds >= 86_400
				? { day: "numeric", month: "short" }
				: {
						day: "numeric",
						hour: "2-digit",
						minute: "2-digit",
						month: "short",
					};
		return new Date(at).toLocaleString(undefined, options);
	}

	const shown = $derived(hovered === null ? null : points[hovered]);
</script>

<section class={plain ? "" : "panel rounded-md p-4"}>
	<div class="mb-3 flex items-baseline justify-between gap-2">
		<h3 class="text-text text-sm font-medium">{title}</h3>
		<span class="text-text-subtle text-xs tabular-nums">
			{#if shown}
				{when(shown.at)} · {shown.value === null ? "—" : format(shown.value)}
			{:else if points.length}
				peak {format(peak)} · avg {format(average)}
			{/if}
		</span>
	</div>
	{#if points.length === 0}
		<p class="text-text-subtle flex h-28 items-center justify-center text-xs">
			{empty}
		</p>
	{:else}
		<div
			class="relative rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
			aria-label="{title}: use the arrow keys to read each point"
			aria-valuemax={points.length - 1}
			aria-valuemin={0}
			aria-valuenow={hovered ?? points.length - 1}
			aria-valuetext={shown
				? `${when(shown.at)}: ${shown.value === null ? "no data" : format(shown.value)}`
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
				class="text-accent h-28 w-full overflow-visible"
				aria-hidden="true"
				preserveAspectRatio="none"
				viewBox="0 0 100 40"
			>
				{#if kind === "bar"}
					{#each points as point, index (point.at)}
						{@const width = Math.max(100 / points.length - 0.6, 0.4)}
						<rect
							class="transition-opacity"
							fill="currentColor"
							height={40 - y(point.value ?? 0)}
							opacity={hovered === null || hovered === index ? 0.85 : 0.35}
							rx="0.4"
							{width}
							x={(index / points.length) * 100 + 0.3}
							y={y(point.value ?? 0)}
						/>
					{/each}
				{:else}
					<polyline
						fill="none"
						points={line}
						stroke="currentColor"
						stroke-linejoin="round"
						stroke-width="1.5"
						vector-effect="non-scaling-stroke"
					/>
					{#if shown && shown.value !== null && hovered !== null}
						<line
							stroke="currentColor"
							stroke-opacity="0.3"
							vector-effect="non-scaling-stroke"
							x1={x(hovered)}
							x2={x(hovered)}
							y1="0"
							y2="40"
						/>
					{/if}
				{/if}
			</svg>
			{#if shown && hovered !== null}
				{#if kind === "line" && shown.value !== null}
					<span
						class="bg-surface pointer-events-none absolute -mt-1 -ml-1 size-2 rounded-full shadow-[0_0_0_2px_currentColor] text-accent"
						style="left: {x(hovered)}%; top: {(y(shown.value) / 40) * 100}%"
					></span>
				{/if}
				<ChartTooltip
					x={clampX(
						entryX(hovered, points.length, hover.width, kind === "line"),
						hover.width,
					)}
					y={0}
				>
					<p class="opacity-75">{when(shown.at)}</p>
					<p>
						<b class="text-sm font-bold"
							>{shown.value === null ? "No data" : format(shown.value)}</b
						>
					</p>
					{#if shown.value !== null}
						<p class="opacity-75">
							{Math.round((shown.value / peak) * 100)}% of the peak
						</p>
					{/if}
				</ChartTooltip>
			{/if}
		</div>
		<div class="text-text-subtle mt-1 flex justify-between text-[0.6875rem]">
			<span>{when(points[0]?.at ?? new Date())}</span>
			<span>{when(points.at(-1)?.at ?? new Date())}</span>
		</div>
	{/if}
</section>
