<script lang="ts">
	import {
		ExternalLink,
		FolderKanban,
		FolderOpen,
		Plus,
		Server,
		Settings as SettingsIcon,
		Trash2,
	} from "@lucide/svelte";
	import { onMount, type Snippet, tick } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList, {
		type EntityRow,
	} from "$lib/components/entity-list.svelte";
	import EntityToolbar from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	type Stack = (typeof data.stacks)[number];

	onMount(() => title.set("Stacks"));

	const view = new ViewMode("stacks", "card");

	function serviceLabel(count: number): string {
		return count === 1 ? "service" : "services";
	}

	function stackHref(id: string): string {
		return resolve("/(protected)/stacks/[stackId]", { stackId: id });
	}

	function settingsHref(id: string): string {
		return resolve("/(protected)/stacks/[stackId]/settings", { stackId: id });
	}

	let deleteTarget = $state<Stack | null>(null);
	let deleteForm = $state<HTMLFormElement | null>(null);
	let deleteDialogOpen = $state(false);
	let forceDelete = $state(false);
	let forceDeleteDialogOpen = $state(false);
	let detachError = $state("");

	function askDelete(stack: Stack) {
		deleteTarget = stack;
		deleteDialogOpen = true;
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Stacks</h1>
      <p class="text-text-muted mt-1 text-sm">
        Group related services together.
      </p>
    </div>
    <Button href={resolve("/stacks/new")} size="sm">
      <Plus class="size-4" />
      New Stack
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={FolderKanban}
      subtitle="Create one to group related services together."
      title="No stacks yet"
    >
      <Button href={resolve("/stacks/new")}>
        <Plus class="size-4" />
        New Stack
      </Button>
    </EmptyState>
  {:else}
    <EntityToolbar placeholder="Search stacks by name…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.stacks.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No stacks match your search.</p>
      </div>
    {:else}
      {#snippet wrapper(item: EntityRow, body: Snippet)}
        {@const stack = data.stacks.find((p) => p.id === item.id)}
        <ContextMenu.Root>
          <ContextMenu.Trigger>
            {@render body()}
          </ContextMenu.Trigger>
          <ContextMenu.Content class="w-56">
            <ContextMenu.Item onSelect={() => goto(stackHref(item.id))}>
              <FolderOpen class="size-4" />
              Open
            </ContextMenu.Item>
            <ContextMenu.Item
              onSelect={() => window.open(stackHref(item.id), "_blank")}
            >
              <ExternalLink class="size-4" />
              Open in new tab
            </ContextMenu.Item>
            <ContextMenu.Item onSelect={() => goto(settingsHref(item.id))}>
              <SettingsIcon class="size-4" />
              Settings
            </ContextMenu.Item>
            {#if stack}
              <ContextMenu.Separator />
              <ContextMenu.Item
                onSelect={() => askDelete(stack)}
                variant="destructive"
              >
                <Trash2 class="size-4" />
                Delete
              </ContextMenu.Item>
            {/if}
          </ContextMenu.Content>
        </ContextMenu.Root>
      {/snippet}

      {#snippet media(_item: { id: string })}
        <span class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
          <FolderKanban class="size-4" />
        </span>
      {/snippet}

      {#snippet meta(item: { id: string })}
        {@const stack = data.stacks.find((p) => p.id === item.id)}
        {#if stack}
          <span class="text-text-subtle flex shrink-0 items-center gap-1.5 text-xs">
            <Server class="size-3.5" />
            {stack.serviceCount}
            {serviceLabel(stack.serviceCount)}
          </span>
        {/if}
      {/snippet}

      <EntityList
        items={data.stacks.map((stack) => ({
          description: stack.description,
          href: stackHref(stack.id),
          id: stack.id,
          title: stack.name,
        }))}
        {media}
        {meta}
        {view}
        {wrapper}
      />

      <Pagination
        label="stacks"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}
  {/if}
</div>

<form
  action={deleteTarget ? `${settingsHref(deleteTarget.id)}?/delete` : undefined}
  class="hidden"
  method="POST"
  bind:this={deleteForm}
  use:enhance={enhanceToast({
    error: "Couldn't delete the stack.",
    loading: "Deleting the stack",
    onFailure: (result) => {
      if (result?.detachFailed && !forceDelete) {
        detachError = String(result.error ?? "");
        forceDeleteDialogOpen = true;
      }
      forceDelete = false;
    },
    success: "Stack deleted.",
  })}
>
  <input name="force" type="hidden" value={forceDelete ? "true" : "false"} />
</form>

<ConfirmDialog
  confirmLabel="Delete stack"
  description="Every service in this stack and its container is removed. This can't be undone."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {deleteTarget?.name ?? 'stack'}?"
  bind:open={deleteDialogOpen}
/>

<ConfirmDialog
  confirmLabel="Delete anyway"
  description={`${detachError} Deleting anyway removes Homerun's records for this stack : any workload still on the host has to be removed by hand.`}
  onConfirm={async () => {
    forceDelete = true;
    await tick();
    deleteForm?.requestSubmit();
  }}
  title="Delete the stack anyway?"
  bind:open={forceDeleteDialogOpen}
/>
