<script lang="ts" module>
	export interface HeartbeatBeat {
		checkedAt: Date | string;
		detail?: string | null;
		latencyMs?: number | null;
		ok: boolean;
	}
</script>

<script lang="ts">
	import { cn } from "@orochibraru/ui/utils";

	import { ChartHover } from "#lib/chart-hover.svelte.js";
	import ChartTooltip from "#lib/components/chart-tooltip.svelte";
	import { timeAgo } from "#lib/formatting.js";

	const {
		beats,
		class: className = "",
		emptyLabel = "No beats recorded yet.",
		showDetail = true,
	}: {
		beats: HeartbeatBeat[];
		class?: string;
		emptyLabel?: string;
		showDetail?: boolean;
	} = $props();

	const hover = new ChartHover(() => beats.length);
	const hovered = $derived(
		hover.index === null ? null : (beats[hover.index] ?? null),
	);

	/** A beat's moment, as the viewer's date and time. */
	function checkedAt(beat: HeartbeatBeat): string {
		return new Date(beat.checkedAt).toLocaleString(undefined, {
			day: "numeric",
			hour: "2-digit",
			minute: "2-digit",
			month: "short",
		});
	}

	/** What a screen reader reads for a beat. */
	function describe(beat: HeartbeatBeat): string {
		const state = beat.ok ? "Up" : "Down";
		return `${state}, ${checkedAt(beat)}`;
	}
</script>

{#if beats.length === 0}
	<div class={cn("flex items-end gap-0.75", className)}>
		<span class="text-text-subtle text-xs">{emptyLabel}</span>
	</div>
{:else}
	<div
		class={cn(
			"relative flex w-fit max-w-full items-end gap-0.75 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
			className,
		)}
		aria-label="Recent checks: use the arrow keys to read each one"
		aria-valuemax={beats.length - 1}
		aria-valuemin={0}
		aria-valuenow={hover.index ?? beats.length - 1}
		aria-valuetext={hovered ? describe(hovered) : undefined}
		onblur={hover.clear}
		onkeydown={hover.key}
		onpointerdown={hover.track}
		onpointerleave={hover.leave}
		onpointermove={hover.track}
		role="slider"
		tabindex="0"
		bind:clientWidth={hover.width}
	>
		{#each beats as beat, i (i)}
			<span
				class="h-5 w-1.25 shrink-0 rounded-[2px] transition-opacity {beat.ok
					? 'bg-emerald-500'
					: 'bg-destructive'} {hover.index !== null && hover.index !== i
					? 'opacity-35'
					: ''}"
			></span>
		{/each}
		{#if hovered}
			<ChartTooltip x={hover.x} y={0}>
				<p class="opacity-75">
					{checkedAt(hovered)} · {timeAgo(hovered.checkedAt)}
				</p>
				<p>
					<b class="text-sm font-bold">{hovered.ok ? "Up" : "Down"}</b>
					{#if hovered.latencyMs !== null && hovered.latencyMs !== undefined}
						· {hovered.latencyMs} ms
					{/if}
				</p>
				{#if showDetail && hovered.detail}
					<p class="max-w-64 truncate opacity-75">{hovered.detail}</p>
				{/if}
			</ChartTooltip>
		{/if}
	</div>
{/if}
