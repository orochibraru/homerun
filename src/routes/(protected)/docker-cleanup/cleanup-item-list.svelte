<script lang="ts">
	import type { CleanupItem } from "$lib/services/docker.service";
	import { formatBytes } from "./cleanup";

	interface Props {
		dimTagged?: boolean;
		items: CleanupItem[];
	}

	const { dimTagged = false, items }: Props = $props();
</script>

{#if items.length === 0}
  <p class="text-text-subtle px-1 py-2 text-xs">Nothing to clean up.</p>
{:else}
  <ul class="max-h-48 space-y-1 overflow-y-auto">
    {#each items as item (item.id)}
      <li
        class="bg-surface-2 flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-xs {dimTagged && item.dangling === false ? 'opacity-40' : ''}"
      >
        <div class="min-w-0">
          <p class="text-text truncate">{item.label}</p>
          {#if item.detail}
            <p class="text-text-subtle truncate">{item.detail}</p>
          {/if}
        </div>
        {#if item.sizeBytes != null}
          <span class="text-text-muted shrink-0">
            {formatBytes(item.sizeBytes)}
          </span>
        {/if}
      </li>
    {/each}
  </ul>
{/if}
