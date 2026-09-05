<script lang="ts" module>
	export type EntityViewMode = "list" | "card";
</script>

<script lang="ts" generics="T">
	import { LayoutGrid, List } from "@lucide/svelte";
	import { Button } from "$lib/components/ui/button/index.js";

	interface Props {
		/** localStorage key suffix (namespaced under "homerun:view:") so each page remembers its own choice independently. */
		card: import("svelte").Snippet<[T]>;
		getKey: (item: T) => string;
		items: T[];
		row: import("svelte").Snippet<[T]>;
		viewKey: string;
	}

	const { items, viewKey, getKey, row, card }: Props = $props();

	const storageKey = $derived(`homerun:view:${viewKey}`);

	function loadInitial(): EntityViewMode {
		if (typeof localStorage === "undefined") {
			return "list";
		}
		try {
			const stored = localStorage.getItem(storageKey);
			return stored === "card" ? "card" : "list";
		} catch {
			return "list";
		}
	}

	let mode = $state<EntityViewMode>(loadInitial());

	function setMode(next: EntityViewMode) {
		mode = next;
		try {
			localStorage.setItem(storageKey, next);
		} catch {
			// Best-effort : a blocked/full localStorage just means the choice
			// doesn't persist across visits, not worth surfacing an error for.
		}
	}
</script>

<div class="mb-3 flex justify-end">
  <div class="glass inline-flex rounded-lg p-0.5">
    <Button
      aria-label="List view"
      class="h-auto px-2 py-1 {mode === 'list' ? 'bg-surface-2' : ''}"
      onclick={() => setMode("list")}
      size="icon-sm"
      variant="ghost"
    >
      <List class="size-3.5" />
    </Button>
    <Button
      aria-label="Card view"
      class="h-auto px-2 py-1 {mode === 'card' ? 'bg-surface-2' : ''}"
      onclick={() => setMode("card")}
      size="icon-sm"
      variant="ghost"
    >
      <LayoutGrid class="size-3.5" />
    </Button>
  </div>
</div>

{#if mode === "list"}
  <div class="space-y-3">
    {#each items as item (getKey(item))}
      {@render row(item)}
    {/each}
  </div>
{:else}
  <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
    {#each items as item (getKey(item))}
      {@render card(item)}
    {/each}
  </div>
{/if}
