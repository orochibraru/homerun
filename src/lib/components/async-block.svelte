<script lang="ts" generics="T">
	import type { RemoteQuery } from "@sveltejs/kit";
	import type { Snippet } from "svelte";
	import Alert from "./alert.svelte";
	import { Button } from "./ui/button/index.js";

	const {
		query,
		errorTitle = "Couldn't load this.",
		pending,
		children,
	}: {
		query: RemoteQuery<T>;
		errorTitle?: string;
		pending: Snippet;
		children: Snippet<[T]>;
	} = $props();

	const message = $derived(
		query.error instanceof Error
			? query.error.message
			: typeof query.error?.message === "string"
				? query.error.message
				: "The server didn't say why.",
	);
</script>

{#if query.error}
  <Alert title={errorTitle}>
    {message}
    {#snippet actions()}
      <Button onclick={() => query.refresh()} size="sm" variant="outline">
        Retry
      </Button>
    {/snippet}
  </Alert>
{:else if query.ready}
  {@render children(query.current)}
{:else}
  {@render pending()}
{/if}
