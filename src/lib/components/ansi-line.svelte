<script lang="ts">
	import { parseAnsiLine } from "$lib/ansi";

	const { line }: { line: string } = $props();

	const segments = $derived(parseAnsiLine(line));
</script>

<div class="break-all whitespace-pre-wrap">
  {#each segments as segment, i (i)}
    <span class={segment.className}>{segment.text}</span>
  {/each}
</div>
