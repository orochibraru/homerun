<script lang="ts">
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import type { ListSelection } from "$lib/list-selection.svelte";

	interface Props {
		noun: string;
		selection: ListSelection;
		visibleCount: number;
	}

	const { noun, selection, visibleCount }: Props = $props();
</script>

<div class="mb-4 flex items-center gap-2.5">
  <Checkbox
    aria-label="Select all {noun}"
    checked={selection.allVisible}
    indeterminate={selection.count > 0 && !selection.allVisible}
    onCheckedChange={() => selection.toggleAllVisible()}
  />
  <span class="text-text-subtle text-xs">
    {selection.count > 0
    ? `${selection.count} selected`
    : `Select all ${visibleCount} on this page`}
  </span>
</div>
