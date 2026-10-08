<script lang="ts">
	import { RotateCw, TriangleAlert } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import Alert from "./alert.svelte";
	import { Button } from "./ui/button/index.js";

	const {
		title = "This page hit an error while rendering.",
		class: className = "",
		compact = false,
		children,
	}: {
		title?: string;
		class?: string;
		/** A small inline retry button instead of a full alert, for header and sidebar chrome. */
		compact?: boolean;
		children: Snippet;
	} = $props();
</script>

<svelte:boundary>
  {@render children()}

  {#snippet failed(error: unknown, reset: () => void)}
    {#if compact}
      <Button
        class="text-red-500"
        onclick={reset}
        size="sm"
        title={error instanceof Error ? error.message : String(error)}
        variant="ghost"
      >
        <TriangleAlert class="size-4" />
        Didn't load, retry
      </Button>
    {:else}
      <div class={className}>
        <Alert {title}>
          {error instanceof Error ? error.message : String(error)}
          {#snippet actions()}
            <Button onclick={reset} size="sm" variant="outline">
              <RotateCw class="size-4" />
              Try again
            </Button>
          {/snippet}
        </Alert>
      </div>
    {/if}
  {/snippet}
</svelte:boundary>
