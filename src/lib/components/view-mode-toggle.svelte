<script lang="ts">
	import { LayoutGrid, List } from "@lucide/svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import type { ViewMode } from "#lib/view-mode.svelte.js";

	const { view }: { view: ViewMode } = $props();
</script>

<div class="panel inline-flex shrink-0 rounded-lg p-0.5">
  <Button
    aria-label="List view"
    aria-pressed={view.current === "list"}
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
    aria-pressed={view.current === "card"}
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
