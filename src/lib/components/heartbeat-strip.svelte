<script lang="ts" module>
	export interface HeartbeatBeat {
		checkedAt: Date | string;
		detail?: string | null;
		ok: boolean;
	}
</script>

<script lang="ts">
	import { timeAgo } from "$lib/formatting";
	import { cn } from "$lib/utils";

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

	function tooltip(beat: HeartbeatBeat): string {
		const when = timeAgo(new Date(beat.checkedAt));
		const state = beat.ok ? "Up" : "Down";
		return showDetail && beat.detail
			? `${state} · ${when} · ${beat.detail}`
			: `${state} · ${when}`;
	}
</script>

<div class={cn("flex items-end gap-0.75", className)}>
  {#each beats as beat, i (i)}
    <span
      class="h-5 w-1.25 shrink-0 rounded-[2px] {beat.ok
      ? 'bg-emerald-500'
      : 'bg-red-500'}"
      title={tooltip(beat)}
    ></span>
  {/each}
  {#if beats.length === 0}
    <span class="text-text-subtle text-xs">{emptyLabel}</span>
  {/if}
</div>
