<script lang="ts">
	import { CheckCircle2, XCircle } from "@lucide/svelte";
	import type { Snippet } from "svelte";

	interface Props {
		error?: string | null;
		iconOnly?: boolean;
		running?: Snippet;
		success: boolean | null;
	}

	const { error, iconOnly = false, running, success }: Props = $props();
</script>

{#if success === null}
  {#if running}
    {@render running()}
  {:else}
    <span class="text-xs text-text-muted">Running</span>
  {/if}
{:else if iconOnly}
  {#if success}
    <CheckCircle2 class="size-3.5 shrink-0 text-emerald-500" />
  {:else}
    <XCircle class="size-3.5 shrink-0 text-red-500" />
  {/if}
{:else if success}
  <span class="flex items-center gap-1 text-xs text-emerald-600">
    <CheckCircle2 class="size-3.5" />
    Success
  </span>
{:else}
  <span class="flex items-center gap-1 text-xs text-red-500" title={error ?? ""}>
    <XCircle class="size-3.5" />
    Failed
  </span>
{/if}
