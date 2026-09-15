<script lang="ts">
	import { RotateCw } from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import Alert from "./alert.svelte";
	import { Button } from "./ui/button/index.js";

	const {
		title = "This page hit an error while rendering.",
		class: className = "",
		children,
	}: {
		title?: string;
		class?: string;
		children: Snippet;
	} = $props();
</script>

<svelte:boundary>
  {@render children()}

  {#snippet failed(error: unknown, reset: () => void)}
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
  {/snippet}
</svelte:boundary>
