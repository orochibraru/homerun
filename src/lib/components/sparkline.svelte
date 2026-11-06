<script lang="ts">
	import type { Snippet } from "svelte";

	import { entryX } from "#lib/chart-hover.js";
	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";

	interface Props {
		class?: string;
		/** CSS colour of the line and its fill. */
		color?: string;
		/** Where the hover tooltip opens. */
		placement?: "above" | "below";
		/** What the hovered value means, given its index; without it the sparkline is decoration only. */
		tip?: Snippet<[number]>;
		values: number[];
	}

	const {
		class: className = "",
		color = "var(--primary)",
		placement = "above",
		tip,
		values,
	}: Props = $props();

	const WIDTH = 120;
	const HEIGHT = 26;

	const high = $derived(Math.max(1, ...values));

	function y(value: number): number {
		return HEIGHT - 1.5 - (value / high) * (HEIGHT - 3);
	}

	const line = $derived.by(() => {
		if (values.length < 2) {
			return "";
		}
		const points = values.map((value, i) => [
			(i / (values.length - 1)) * WIDTH,
			y(value),
		]);
		let path = `M${points[0][0]},${points[0][1]}`;
		for (let i = 1; i < points.length; i++) {
			const [x0, y0] = points[i - 1];
			const [x1, y1] = points[i];
			const mid = (x0 + x1) / 2;
			path += ` C${mid},${y0} ${mid},${y1} ${x1},${y1}`;
		}
		return path;
	});

	const hover = new ChartHover(() => (tip ? values.length : 0), true);
	const hovered = $derived(hover.index);
</script>

<div
	class="relative {className}"
	onpointerdown={hover.track}
	onpointerleave={hover.clear}
	onpointermove={hover.track}
	role="presentation"
	bind:clientWidth={hover.width}
>
	<svg
		class="block h-6.5 w-full"
		aria-hidden="true"
		preserveAspectRatio="none"
		viewBox="0 0 {WIDTH} {HEIGHT}"
	>
		{#if line}
			<path
				d="{line} L{WIDTH},{HEIGHT} L0,{HEIGHT}Z"
				fill={color}
				opacity="0.1"
			/>
			<path
				d={line}
				fill="none"
				stroke={color}
				stroke-linecap="round"
				stroke-width="1.6"
				vector-effect="non-scaling-stroke"
			/>
			{#if hovered !== null}
				{@const x = entryX(hovered, values.length, WIDTH, true)}
				<line
					stroke={color}
					stroke-dasharray="2 3"
					stroke-opacity="0.6"
					vector-effect="non-scaling-stroke"
					x1={x}
					x2={x}
					y1="0"
					y2={HEIGHT}
				/>
			{/if}
		{/if}
	</svg>
	{#if line && hovered !== null && tip}
		<span
			class="bg-surface pointer-events-none absolute -mt-1 -ml-1 size-2 rounded-full"
			style="left: {entryX(
				hovered,
				values.length,
				hover.width,
				true,
			)}px; top: {y(values[hovered] ?? 0)}px; box-shadow: 0 0 0 2px {color}"
		></span>
		<ChartTooltip {placement} x={hover.x} y={placement === "above" ? 0 : 26}>
			{@render tip(hovered)}
		</ChartTooltip>
	{/if}
</div>
