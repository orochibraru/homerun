<script lang="ts">
	import CopyButton from "$lib/components/copy-button.svelte";
	import { cn } from "$lib/utils";

	const {
		value,
		label,
		class: className = "",
		truncate = false,
	}: {
		value: string;
		label?: string;
		class?: string;
		truncate?: boolean;
	} = $props();
</script>

<div
  class={cn(
    "border-border bg-surface-2 flex items-center gap-2 rounded-lg border py-1.5 pr-1.5 pl-3",
    className,
  )}
>
  <code
    class={cn(
      "text-text min-w-0 flex-1 font-mono text-xs",
      truncate ? "truncate" : "overflow-x-auto whitespace-nowrap",
    )}
  >{value}</code>
  <CopyButton {label} {value} />
</div>
