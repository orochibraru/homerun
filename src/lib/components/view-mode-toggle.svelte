<script lang="ts">
	import { LayoutGrid, List } from "@lucide/svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { ViewMode } from "$lib/view-mode.svelte";

	const { view }: { view: ViewMode } = $props();
</script>

<div class="glass inline-flex shrink-0 rounded-lg p-0.5">
  <Button
    aria-label="List view"
    class="h-auto px-2 py-1 {view.current === 'list' ? 'bg-surface-2' : ''}"
    onclick={() => {
      view.current = "list";
    }}
    size="icon-sm"
    variant="ghost"
  >
    <List class="size-3.5" />
  </Button>
  <Button
    aria-label="Card view"
    class="h-auto px-2 py-1 {view.current === 'card' ? 'bg-surface-2' : ''}"
    onclick={() => {
      view.current = "card";
    }}
    size="icon-sm"
    variant="ghost"
  >
    <LayoutGrid class="size-3.5" />
  </Button>
</div>
