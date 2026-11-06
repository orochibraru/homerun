<script lang="ts" module>
	import type { SystemStats } from "#lib/services/system-stats.service.js";

	const seen: { last: SystemStats | null } = { last: null };
</script>

<script lang="ts">
	import { Cpu, HardDrive, MemoryStick } from "@lucide/svelte";
	import { onMount } from "svelte";

	import ChartHoverTarget from "#lib/components/chart-hover-target.svelte";
	import ResourceInsightsDialog from "#lib/components/resource-insights-dialog.svelte";
	import { getSystemStats } from "#lib/remote/system-stats.remote.js";
	import type { InsightResource } from "#lib/services/resource-insights.service.js";

	const POLL_MS = 5000;

	const stats = getSystemStats();

	let insightOpen = $state(false);
	let insightResource = $state<InsightResource>("cpu");

	$effect(() => {
		if (stats.ready) {
			seen.last = stats.current;
		}
	});

	onMount(() => {
		const timer = setInterval(() => {
			void stats.refresh();
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	function pct(used: number, total: number): number {
		if (total <= 0) {
			return 0;
		}
		return Math.max(0, Math.min(100, (used / total) * 100));
	}

	function barColor(percent: number): string {
		if (percent >= 90) {
			return "bg-red-500";
		}
		if (percent >= 70) {
			return "bg-amber-500";
		}
		return "bg-accent";
	}
</script>

{#snippet meter(
	label: string,
	Icon: typeof Cpu,
	value: string,
	percent: number,
	resource: InsightResource,
)}
	<div class="min-w-0 flex-1 px-4 py-3">
		<div class="flex items-baseline justify-between gap-2">
			<span class="eyebrow flex items-center gap-1.5">
				<Icon class="size-3" />
				{label}
			</span>
			<span class="metric text-[1.0625rem]"
				>{percent.toFixed(0)}<span class="text-text-subtle text-xs font-normal"
					>%</span
				></span
			>
		</div>
		<ChartHoverTarget
			class="mt-1 py-1"
			label="{label}: {percent.toFixed(0)}%, {value}, open to see what uses it"
			onselect={() => {
				insightResource = resource;
				insightOpen = true;
			}}
		>
			{#snippet tip()}
				<p class="opacity-75">{label}</p>
				<p><b class="text-sm font-bold">{percent.toFixed(1)}%</b> used</p>
				<p class="opacity-75">{value}</p>
				<p class="opacity-75">Click to see what uses it</p>
			{/snippet}
			<span class="bg-surface-2 block h-0.75 overflow-hidden">
				<span
					class="block h-full transition-all duration-500 {barColor(percent)}"
					style="width: {percent}%"
				></span>
			</span>
		</ChartHoverTarget>
		<p class="tabular-nums text-text-subtle mt-1.5 text-[0.6875rem]">{value}</p>
	</div>
{/snippet}

<div class="panel rounded-xl" data-slot="host-resources">
	{#if stats.error}
		<p class="text-text-muted px-4 py-3 text-xs">
			Host resource stats are unavailable right now.
		</p>
	{:else}
		{@const s = stats.ready ? stats.current : seen.last}
		<div
			class="divide-border flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0"
		>
			{@render meter(
				"CPU",
				Cpu,
				`${(s?.cpuPercent ?? 0).toFixed(0)}%`,
				s?.cpuPercent ?? 0,
				"cpu",
			)}
			{@render meter(
				"RAM",
				MemoryStick,
				s
					? `${(s.memUsedMb / 1024).toFixed(1)} / ${(s.memTotalMb / 1024).toFixed(1)} GB`
					: "– / – GB",
				s ? pct(s.memUsedMb, s.memTotalMb) : 0,
				"memory",
			)}
			{@render meter(
				"Disk",
				HardDrive,
				!s
					? "– / – GB"
					: s.diskUsedGb !== null && s.diskTotalGb !== null
						? `${s.diskUsedGb.toFixed(0)} / ${s.diskTotalGb.toFixed(0)} GB`
						: "unavailable",
				s ? pct(s.diskUsedGb ?? 0, s.diskTotalGb ?? 0) : 0,
				"disk",
			)}
		</div>

		{#if s?.gpu}
			<div class="border-border border-t px-4 py-3">
				<div class="flex items-baseline justify-between gap-2">
					<span class="eyebrow truncate">GPU · {s.gpu.name}</span>
					<span class="tabular-nums text-text-subtle text-[0.6875rem]">
						{s.gpu.utilizationPercent}% ·
						{(s.gpu.memUsedMb / 1024).toFixed(1)}
						/
						{(s.gpu.memTotalMb / 1024).toFixed(1)}
						GB
					</span>
				</div>
				<ChartHoverTarget
					class="mt-1 py-1"
					label="GPU: {s.gpu.utilizationPercent}% busy"
				>
					{#snippet tip()}
						<p class="opacity-75">{s.gpu?.name}</p>
						<p>
							<b class="text-sm font-bold">{s.gpu?.utilizationPercent}%</b> busy
						</p>
						<p class="opacity-75">
							{((s.gpu?.memUsedMb ?? 0) / 1024).toFixed(1)} of {(
								(s.gpu?.memTotalMb ?? 0) / 1024
							).toFixed(1)} GB memory
						</p>
					{/snippet}
					<span class="bg-surface-2 block h-0.75 overflow-hidden">
						<span
							class="block h-full transition-all duration-500 {barColor(
								s.gpu.utilizationPercent,
							)}"
							style="width: {s.gpu.utilizationPercent}%"
						></span>
					</span>
				</ChartHoverTarget>
			</div>
		{/if}
	{/if}
</div>

<ResourceInsightsDialog resource={insightResource} bind:open={insightOpen} />
