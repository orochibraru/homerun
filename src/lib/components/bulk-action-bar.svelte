<script lang="ts">
	import type { SubmitFunction } from "@sveltejs/kit";
	import type { Snippet } from "svelte";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { ListSelection } from "$lib/list-selection.svelte";

	interface Props {
		action: string;
		children: Snippet;
		form?: HTMLFormElement | null;
		idField: string;
		label: string;
		pending: boolean;
		selection: ListSelection;
		submit: SubmitFunction;
	}

	let {
		action,
		children,
		form = $bindable(null),
		idField,
		label,
		pending,
		selection,
		submit,
	}: Props = $props();
</script>

{#if selection.count > 0}
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
    <form
      {action}
      class="panel-strong pointer-events-auto flex flex-wrap items-center gap-2 rounded-md px-4 py-3 shadow-lg"
      method="POST"
      bind:this={form}
      use:enhance={submit}
    >
      {#each selection.ids as id (id)}
        <input name={idField} type="hidden" value={id}>
      {/each}

      <span class="text-text mr-1 text-sm font-medium">
        {selection.count}
        {label} selected
      </span>

      {@render children()}

      <Button
        disabled={pending}
        onclick={() => selection.clear()}
        size="sm"
        type="button"
        variant="ghost"
      >
        Clear
      </Button>
    </form>
  </div>
{/if}
