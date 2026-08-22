<script lang="ts">
	import { Container, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Build Cache Registries"));

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-2xl font-bold">Build Cache Registries</h1>
      <p class="text-text-muted mt-1 text-sm">
        Docker registries used to cache layers between git builds. Pick one
        from a git-based service's Source tab so a rebuild reuses unchanged
        layers instead of starting from scratch.
      </p>
    </div>
    <Button href={resolve("/build-cache-registries/new")}>
      <Plus class="size-4" />
      Add Registry
    </Button>
  </div>

  {#if data.registries.length === 0}
    <EmptyState
      icon={Container}
      subtitle="Add one, then pick it from a git-based service's Source tab."
      title="No build cache registries yet"
    >
      <Button href={resolve("/build-cache-registries/new")}>
        <Plus class="size-4" />
        Add your first registry
      </Button>
    </EmptyState>
  {:else}
    <div class="space-y-3">
      {#each data.registries as reg (reg.id)}
        <div class="border-border bg-surface flex items-center gap-4 rounded-2xl border p-5">
          <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Container class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-semibold">
              {reg.name}
            </p>
            <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
              {reg.registryUrl}
              · {reg.username}
            </p>
          </div>
          <form
            action="?/delete"
            method="POST"
            use:enhance={() => async ({ result, update }) => {
              if (result.type === "failure") {
                toast.error(
                  "Couldn't delete : make sure no service still uses it.",
                );
              }
              await update();
            }}
          >
            <input name="registryId" type="hidden" value={reg.id}>
            <Button
              class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
              onclick={(e) => requestDelete(e, reg.name)}
              size="icon-sm"
              title="Delete"
              type="button"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Any service still picking it will fall back to no build cache.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete build cache registry"
/>
