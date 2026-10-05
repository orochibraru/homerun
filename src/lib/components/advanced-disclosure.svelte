<script lang="ts">
	import { ChevronDown } from "@lucide/svelte";
	import type { Snippet } from "svelte";

	interface Props {
		children: Snippet;
		collapsible: boolean;
		description?: string;
		label?: string;
	}

	const {
		children,
		collapsible,
		description,
		label = "Advanced",
	}: Props = $props();

	let open = $state(false);
</script>

{#if collapsible}
  <div class="border-border rounded-md border">
    <button
      aria-expanded={open}
      class="hover:bg-surface-2 flex w-full items-center gap-2 rounded-md px-3 py-2.5 text-left"
      onclick={() => {
        open = !open;
      }}
      type="button"
    >
      <ChevronDown
        class="text-text-muted size-4 shrink-0 transition-transform {open ? 'rotate-180' : ''}"
      />
      <span class="text-text text-sm font-medium">{label}</span>
      {#if description}
        <span class="text-text-subtle truncate text-xs">{description}</span>
      {/if}
    </button>
    <div class="border-border space-y-5 border-t p-4" class:hidden={!open}>
      {@render children()}
    </div>
  </div>
{:else}
  {@render children()}
{/if}
