<script lang="ts" module>
	export interface EntityRow {
		description?: string | null;
		href?: string;
		id: string;
		subtitle?: string | null;
		title: string;
	}
</script>

<script lang="ts" generics="T extends EntityRow">
	import type { Snippet } from "svelte";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import type { ViewMode } from "$lib/view-mode.svelte";

	interface Props {
		actions?: Snippet<[T]>;
		badge?: Snippet<[T]>;
		cardGridClass?: string;
		items: T[];
		media?: Snippet<[T]>;
		meta?: Snippet<[T]>;
		onToggleSelect?: (id: string) => void;
		selectLabel?: (item: T) => string;
		selectedIds?: string[];
		view: ViewMode;
	}

	const {
		items,
		view,
		media,
		badge,
		meta,
		actions,
		selectedIds,
		onToggleSelect,
		selectLabel = (item: T) => `Select ${item.title}`,
		cardGridClass = "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3",
	}: Props = $props();

	const selected = $derived(new Set(selectedIds ?? []));
	const selectable = $derived(!!(selectedIds && onToggleSelect));
</script>

{#snippet text(item: EntityRow, clamp: boolean)}
  <p class="text-text truncate text-sm font-medium">{item.title}</p>
  {#if item.subtitle}
    <p class="text-text-subtle truncate text-xs">{item.subtitle}</p>
  {/if}
  {#if item.description}
    <p class="text-text-muted mt-0.5 text-xs {clamp ? 'line-clamp-2' : 'truncate'}">
      {item.description}
    </p>
  {/if}
{/snippet}

{#if view.current === "list"}
  <div class="panel divide-border divide-y overflow-hidden rounded-xl">
    {#each items as item (item.id)}
      <div
        class="hover:bg-surface-2 flex items-center gap-3 px-4 py-3 transition-colors {selected.has(
        item.id,
      )
        ? 'bg-accent-light'
        : ''}"
      >
        {#if selectable}
          <Checkbox
            aria-label={selectLabel(item)}
            checked={selected.has(item.id)}
            onCheckedChange={() => onToggleSelect?.(item.id)}
          />
        {/if}
        {#if item.href}
          <a class="flex min-w-0 flex-1 items-center gap-3" href={item.href}>
            {@render media?.(item)}
            <span class="min-w-0 flex-1">
              {@render text(item, false)}
            </span>
          </a>
        {:else}
          <div class="flex min-w-0 flex-1 items-center gap-3">
            {@render media?.(item)}
            <span class="min-w-0 flex-1">
              {@render text(item, false)}
            </span>
          </div>
        {/if}
        <div class="flex shrink-0 items-center gap-2">
          {@render badge?.(item)}
          {@render meta?.(item)}
          {@render actions?.(item)}
        </div>
      </div>
    {/each}
  </div>
{:else}
  <div class={cardGridClass}>
    {#each items as item (item.id)}
      <div
        class="panel flex flex-col rounded-xl p-4 transition-colors {selected.has(
        item.id,
      )
        ? 'border-accent/50 bg-accent-light'
        : ''}"
      >
        <div class="flex items-start gap-3">
          {#if selectable}
            <Checkbox
              aria-label={selectLabel(item)}
              checked={selected.has(item.id)}
              onCheckedChange={() => onToggleSelect?.(item.id)}
            />
          {/if}
          {@render media?.(item)}
          <div class="min-w-0 flex-1">
            {#if item.href}
              <a class="block min-w-0" href={item.href}>
                {@render text(item, true)}
              </a>
            {:else}
              {@render text(item, true)}
            {/if}
          </div>
          {@render badge?.(item)}
        </div>
        {#if meta || actions}
          <div class="border-border mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <div class="min-w-0">{@render meta?.(item)}</div>
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              {@render actions?.(item)}
            </div>
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
