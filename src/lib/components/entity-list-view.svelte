<script lang="ts" generics="T">
	import type { Snippet } from "svelte";
	import type { ViewMode } from "$lib/view-mode.svelte";

	interface Props {
		card: Snippet<[T]>;
		cardGridClass?: string;
		getKey: (item: T) => string;
		items: T[];
		row: Snippet<[T]>;
		view: ViewMode;
	}

	const {
		items,
		getKey,
		row,
		card,
		view,
		cardGridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3",
	}: Props = $props();
</script>

{#if view.current === "list"}
  <div class="space-y-3">
    {#each items as item (getKey(item))}
      {@render row(item)}
    {/each}
  </div>
{:else}
  <div class={cardGridClass}>
    {#each items as item (getKey(item))}
      {@render card(item)}
    {/each}
  </div>
{/if}
