<script lang="ts">
	import { entryX } from "#lib/chart-hover.js";
	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";
	import type { IncidentSample } from "#lib/resource-incidents.js";
	import {
		RESOURCE_KINDS,
		RESOURCE_LABELS,
		type ResourceKind,
		type Threshold,
	} from "#lib/resource-thresholds.js";

	interface Props {
		/** The resource the incident is about, drawn on top with its limits. */
		kind: ResourceKind;
		samples: IncidentSample[];
		threshold: Threshold;
	}

	const { kind, samples, threshold }: Props = $props();

	const WIDTH = 600;
	const HEIGHT = 180;

	const COLORS: Record<ResourceKind, string> = {
		cpu: "var(--chart-1)",
		disk: "var(--chart-3)",
		gpu: "var(--chart-4)",
		memory: "var(--chart-2)",
	};

	const kinds = $derived(
		RESOURCE_KINDS.filter((resource) =>
			samples.some((sample) => sample.percents[resource] !== undefined),
		).toSorted((a, b) => Number(a === kind) - Number(b === kind)),
	);

	function x(index: number): number {
		return samples.length < 2
			? WIDTH / 2
			: (index / (samples.length - 1)) * WIDTH;
	}

	function y(percent: number): number {
		return HEIGHT - (percent / 100) * HEIGHT;
	}

	function path(resource: ResourceKind): string {
		return samples
			.flatMap((sample, index) => {
				const percent = sample.percents[resource];
				return percent === undefined ? [] : [`${x(index)},${y(percent)}`];
			})
			.map((point, index) => `${index === 0 ? "M" : "L"}${point}`)
			.join(" ");
	}

	const hover = new ChartHover(() => samples.length, true);
	const hovered = $derived(hover.index === null ? null : samples[hover.index]);
</script>

<div class="flex flex-wrap gap-3 text-xs">
	{#each kinds as resource (resource)}
		<span class="text-text-muted flex items-center gap-1.5">
			<span
				class="inline-block size-2 rounded-full"
				style="background: {COLORS[resource]}"
			></span>
			{RESOURCE_LABELS[resource]}
		</span>
	{/each}
	<span class="text-text-subtle flex items-center gap-1.5">
		<span class="inline-block w-3 border-t border-dashed border-current"></span>
		{RESOURCE_LABELS[kind]} limits ({threshold.soft}% soft, {threshold.hard}%
		hard)
	</span>
</div>

{#if samples.length === 0}
	<p class="text-text-muted mt-3 text-sm">
		No readings were recorded for this incident.
	</p>
{:else}
	<div
		class="relative mt-3"
		onpointerdown={hover.track}
		onpointerleave={hover.leave}
		onpointermove={hover.track}
		role="presentation"
		bind:clientWidth={hover.width}
	>
		<svg
			class="block h-48 w-full"
			aria-label="{RESOURCE_LABELS[
				kind
			]} and the host's other resources over the incident"
			preserveAspectRatio="none"
			role="img"
			viewBox="0 0 {WIDTH} {HEIGHT}"
		>
			{#each new Set([threshold.soft, threshold.hard]) as limit (limit)}
				<line
					stroke="currentColor"
					stroke-dasharray="4 4"
					stroke-opacity="0.35"
					vector-effect="non-scaling-stroke"
					x1="0"
					x2={WIDTH}
					y1={y(limit)}
					y2={y(limit)}
				/>
			{/each}
			{#each kinds as resource (resource)}
				<path
					d={path(resource)}
					fill="none"
					stroke={COLORS[resource]}
					stroke-linejoin="round"
					stroke-opacity={resource === kind ? 1 : 0.45}
					stroke-width={resource === kind ? 2.2 : 1.4}
					vector-effect="non-scaling-stroke"
				/>
			{/each}
			{#if hover.index !== null}
				{@const at = entryX(hover.index, samples.length, WIDTH, true)}
				<line
					stroke="currentColor"
					stroke-dasharray="2 3"
					stroke-opacity="0.5"
					vector-effect="non-scaling-stroke"
					x1={at}
					x2={at}
					y1="0"
					y2={HEIGHT}
				/>
			{/if}
		</svg>
		<div class="text-text-subtle mt-1 flex justify-between text-[0.6875rem]">
			<span>{new Date(samples[0]?.at ?? 0).toLocaleTimeString()}</span>
			<span>
				{new Date(samples.at(-1)?.at ?? 0).toLocaleTimeString()}
			</span>
		</div>
		{#if hovered}
			<ChartTooltip x={hover.x} y={0}>
				<p class="text-text-muted mb-1 text-xs">
					{new Date(hovered.at).toLocaleString()}
				</p>
				{#each kinds as resource (resource)}
					{#if hovered.percents[resource] !== undefined}
						<p class="text-xs">
							<span style="color: {COLORS[resource]}">●</span>
							{RESOURCE_LABELS[resource]}
							<span class="font-semibold tabular-nums"
								>{hovered.percents[resource]}%</span
							>
						</p>
					{/if}
				{/each}
			</ChartTooltip>
		{/if}
	</div>
{/if}
