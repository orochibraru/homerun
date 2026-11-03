<script lang="ts">
	import { type Capacity, usedPercent } from "#lib/backup-capacity.js";
	import ChartHoverTarget from "#lib/components/chart-hover-target.svelte";
	import { formatBytes, timeAgo } from "#lib/formatting.js";

	interface Props {
		capacity: Capacity | null;
		checkedAt: Date | string | null;
		error: string | null;
		thresholdPercent: number;
	}

	const { capacity, checkedAt, error, thresholdPercent }: Props = $props();

	const percent = $derived(capacity ? usedPercent(capacity) : 0);
	const tone = $derived(
		percent >= 95
			? "bg-red-500"
			: percent >= thresholdPercent
				? "bg-amber-500"
				: "bg-accent",
	);
</script>

<div class="min-w-0 space-y-1.5">
	{#if capacity}
		<ChartHoverTarget
			class="rounded-full py-1"
			label="{formatBytes(capacity.usedBytes)} of {formatBytes(
				capacity.totalBytes,
			)} used, {Math.round(percent)}%"
		>
			{#snippet tip()}
				<p>
					<b class="text-sm font-bold">{formatBytes(capacity.usedBytes)}</b>
					of {formatBytes(capacity.totalBytes)} used
				</p>
				<p class="opacity-75">
					{Math.round(percent)}% · {formatBytes(capacity.freeBytes)} free · alert
					at {thresholdPercent}%
				</p>
			{/snippet}
			<span
				class="bg-surface-2 block h-2 w-full overflow-hidden rounded-full"
				aria-hidden="true"
			>
				<span class="block h-full rounded-full {tone}" style="width: {percent}%"
				></span>
			</span>
		</ChartHoverTarget>
		<p class="text-text-muted text-xs tabular-nums">
			{formatBytes(capacity.freeBytes)} free of {formatBytes(
				capacity.totalBytes,
			)}
			· {Math.round(percent)}% used
			{#if checkedAt}
				<span class="text-text-subtle">· checked {timeAgo(checkedAt)}</span>
			{/if}
		</p>
	{:else if checkedAt}
		<p class="text-text-subtle text-xs">
			Size unknown{error ? `: ${error}` : ""}
		</p>
	{:else}
		<p class="text-text-subtle text-xs">Size not checked yet</p>
	{/if}
	{#if capacity && error}
		<p class="text-xs text-amber-600">Last check failed: {error}</p>
	{/if}
</div>
