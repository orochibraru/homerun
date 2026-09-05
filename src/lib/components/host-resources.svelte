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
  <div>
    <div class="mb-1.5 flex items-center justify-between text-xs">
      <span class="text-text-muted flex items-center gap-1.5 font-medium">
        <Icon class="size-3.5" />
        {label}
      </span>
      <span class="tech text-text-subtle">{value}</span>
    </div>
    <div class="bg-surface-2 h-1.5 overflow-hidden rounded-full">
      <div
        class="h-full rounded-full transition-all duration-500 {barColor(percent)}"
        style="width: {percent}%"
      ></div>
    </div>
  </div>
{/snippet}

{#snippet meterSkeleton()}
  <div>
    <div class="mb-1.5 flex items-center justify-between">
      <Skeleton class="h-3.5 w-16" />
      <Skeleton class="h-3.5 w-20" />
    </div>
    <Skeleton class="h-1.5 w-full rounded-full" />
  </div>
{/snippet}

<div class="glass mb-8 rounded-2xl p-5">
  <h2 class="eyebrow mb-4">Host Resources</h2>

  {#if stats.error}
    <p class="text-text-muted text-sm">Host resource stats are unavailable right now.</p>
  {:else if stats.ready}
    {@const s = stats.current}
    <div class="grid gap-5 sm:grid-cols-3">
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
      <div class="border-border mt-5 border-t pt-4">
        <div class="mb-1.5 flex items-center justify-between text-xs">
          <span class="text-text-muted font-medium">GPU · {s.gpu.name}</span>
          <span class="tech text-text-subtle">
            {s.gpu.utilizationPercent}% ·
            {(s.gpu.memUsedMb / 1024).toFixed(1)}
            /
            {(s.gpu.memTotalMb / 1024).toFixed(1)}
            GB
          </span>
        </div>
        <div class="bg-surface-2 h-1.5 overflow-hidden rounded-full">
          <div
            class="h-full rounded-full transition-all duration-500 {barColor(
              s.gpu.utilizationPercent,
            )}"
            style="width: {s.gpu.utilizationPercent}%"
          ></div>
        </div>
      </div>
    {/if}
  {:else}
    <div class="grid gap-5 sm:grid-cols-3">
      {@render meterSkeleton()}
      {@render meterSkeleton()}
      {@render meterSkeleton()}
    </div>
  {/if}
</div>
