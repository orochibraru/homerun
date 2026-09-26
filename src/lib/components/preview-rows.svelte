<script lang="ts">
	import { Bird, GitPullRequest } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import type { PreviewRow } from "$lib/service-graph";
	import type { ContainerStatus } from "$lib/types";

	interface Props {
		class?: string;
		previews: PreviewRow[];
	}

	const { class: className = "", previews }: Props = $props();
</script>

{#if previews.length > 0}
  <ul class="border-border space-y-0.5 border-l pl-3 {className}">
    {#each previews as preview (preview.id)}
      <li>
        <a
          class="hover:bg-surface-2 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-xs"
          href={resolve("/(protected)/services/[serviceId]", {
            serviceId: preview.id,
          })}
        >
          {#if preview.canary}
            <Bird class="text-text-subtle size-3.5 shrink-0" />
            <span class="text-text shrink-0 font-medium">Canary</span>
            <span class="text-text-muted min-w-0 flex-1 truncate">{preview.name}</span>
          {:else}
            <GitPullRequest class="text-text-subtle size-3.5 shrink-0" />
            <span class="text-text shrink-0 font-medium">#{preview.prNumber}</span>
            <span class="text-text-muted min-w-0 flex-1 truncate">
              {preview.title ?? preview.branch ?? preview.name}
            </span>
          {/if}
          <StatusBadge status={preview.currentStatus as ContainerStatus} />
        </a>
      </li>
    {/each}
  </ul>
{/if}
