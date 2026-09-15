<script lang="ts">
	import { Cpu, HardDrive, MemoryStick } from "@lucide/svelte";
	import { onMount } from "svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { getSystemStats } from "$lib/remote/system-stats.remote";

	const POLL_MS = 5000;

	const stats = getSystemStats();

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

{#snippet meter(label: string, Icon: typeof Cpu, value: string, percent: number)}
  <div class="min-w-0 flex-1 px-4 py-3">
    <div class="flex items-baseline justify-between gap-2">
      <span class="eyebrow flex items-center gap-1.5">
        <Icon class="size-3" />
        {label}
      </span>
      <span class="metric text-[1.0625rem]">{percent.toFixed(0)}<span class="text-text-subtle text-xs font-normal">%</span></span>
    </div>
    <div class="bg-surface-2 mt-2 h-[3px] overflow-hidden">
      <div
        class="h-full transition-all duration-500 {barColor(percent)}"
        style="width: {percent}%"
      ></div>
    </div>
    <p class="tabular-nums text-text-subtle mt-1.5 text-[0.6875rem]">{value}</p>
  </div>
{/snippet}

{#snippet meterSkeleton()}
  <div class="min-w-0 flex-1 px-4 py-3">
    <div class="flex items-center justify-between">
      <Skeleton class="h-3 w-12" />
      <Skeleton class="h-4 w-10" />
    </div>
    <Skeleton class="mt-2 h-[3px] w-full" />
    <Skeleton class="mt-1.5 h-3 w-20" />
  </div>
{/snippet}

<div class="panel">
  {#if stats.error}
    <p class="text-text-muted px-4 py-3 text-xs">Host resource stats are unavailable right now.</p>
  {:else if stats.ready}
    {@const s = stats.current}
    <div class="divide-border flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0">
      {@render meter(
        "CPU",
        Cpu,
        `${s.cpuPercent.toFixed(0)}%`,
        s.cpuPercent,
      )}
      {@render meter(
        "RAM",
        MemoryStick,
        `${(s.memUsedMb / 1024).toFixed(1)} / ${(s.memTotalMb / 1024).toFixed(1)} GB`,
        pct(s.memUsedMb, s.memTotalMb),
      )}
      {@render meter(
        "Disk",
        HardDrive,
        s.diskUsedGb !== null && s.diskTotalGb !== null
          ? `${s.diskUsedGb.toFixed(0)} / ${s.diskTotalGb.toFixed(0)} GB`
          : "unavailable",
        pct(s.diskUsedGb ?? 0, s.diskTotalGb ?? 0),
      )}
    </div>

    {#if s.gpu}
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
        <div class="bg-surface-2 mt-2 h-[3px] overflow-hidden">
          <div
            class="h-full transition-all duration-500 {barColor(
              s.gpu.utilizationPercent,
            )}"
            style="width: {s.gpu.utilizationPercent}%"
          ></div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="divide-border flex flex-col divide-y sm:flex-row sm:divide-x sm:divide-y-0">
      {@render meterSkeleton()}
      {@render meterSkeleton()}
      {@render meterSkeleton()}
    </div>
  {/if}
</div>
