<script lang="ts">
	import { ArrowDownRight, ArrowUpRight, Minus } from "@lucide/svelte";
	import type { Change } from "$lib/metrics-format";

	const {
		change,
		label,
	}: { change: Change | null | undefined; label?: string } = $props();

	const tone = $derived(
		change?.direction === "better"
			? "text-emerald-600 dark:text-emerald-400"
			: change?.direction === "worse"
				? "text-red-600 dark:text-red-400"
				: "text-text-subtle",
	);
</script>

{#if change}
  <span class="inline-flex items-center gap-0.5 text-xs font-medium tabular-nums {tone}" title={label}>
    {#if change.text.startsWith("+")}
      <ArrowUpRight class="size-3" />
    {:else if change.text.startsWith("−")}
      <ArrowDownRight class="size-3" />
    {:else}
      <Minus class="size-3" />
    {/if}
    {change.text}
  </span>
{/if}
