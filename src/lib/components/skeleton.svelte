<script lang="ts">
	import { cn } from "$lib/utils";

	const { class: className = "" }: { class?: string } = $props();
</script>

<div
  aria-hidden="true"
  class={cn("bg-surface-2 animate-pulse rounded-md", className)}
></div>
