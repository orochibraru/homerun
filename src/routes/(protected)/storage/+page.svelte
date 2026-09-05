<script lang="ts">
	import { CloudUpload, HardDrive, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityListView from "$lib/components/entity-list-view.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Storage"));

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
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Storage</h1>
      <p class="text-text-muted mt-1 text-sm">
        Local volume sources services can mount for persistent or shared data.
      </p>
    </div>
    <Button href={resolve("/storage/new")}>
      <Plus class="size-4" />
      New Volume
    </Button>
  </div>

  {#if data.volumes.length === 0}
    <EmptyState
      icon={HardDrive}
      subtitle="Create one, then mount it into a service from its Settings tab."
      title="No storage volumes yet"
    >
      {#snippet children()}
        <Button href={resolve("/storage/new")}>
          <Plus class="size-4" />
          New Volume
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    {#snippet volActions(vol: (typeof data.volumes)[number])}
      <Button
        href={resolve("/(protected)/storage/[volumeId]", {
          volumeId: vol.id,
        })}
        size="icon-sm"
        title="Backup settings"
        variant="ghost"
      >
        <CloudUpload class="size-4" />
      </Button>
      <form
        action="?/delete"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't delete the volume.",
          loading: "Deleting the volume",
          success: "Volume deleted.",
        })}
      >
        <input name="volumeId" type="hidden" value={vol.id} />
        <Button
          class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
          onclick={(e) => requestDelete(e, vol.name)}
          size="icon-sm"
          title="Delete"
          type="button"
          variant="ghost"
        >
          <Trash2 class="size-4" />
        </Button>
      </form>
    {/snippet}

    {#snippet row(vol: (typeof data.volumes)[number])}
      <div class="glass flex items-center gap-4 rounded-2xl p-5">
        <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
          <HardDrive class="size-5" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-text truncate text-sm font-semibold">
            {vol.name}
          </p>
          <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
            {vol.kind === "bind" ? "bind" : "volume"}
            · {vol.source}
          </p>
          {#if vol.description}
            <p class="text-text-subtle mt-0.5 truncate text-xs">
              {vol.description}
            </p>
          {/if}
          {#if vol.backupEnabled}
            <p class="mt-0.5 flex items-center gap-1 text-xs text-emerald-600">
              <CloudUpload class="size-3" />
              auto-backup on
            </p>
          {/if}
        </div>
        {@render volActions(vol)}
      </div>
    {/snippet}

    {#snippet card(vol: (typeof data.volumes)[number])}
      <div class="glass flex flex-col gap-3 rounded-2xl p-5">
        <div class="flex items-center gap-3">
          <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
            <HardDrive class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-semibold">{vol.name}</p>
            <p class="text-text-muted truncate font-mono text-xs">
              {vol.kind === "bind" ? "bind" : "volume"}
              · {vol.source}
            </p>
          </div>
        </div>
        {#if vol.backupEnabled}
          <p class="flex items-center gap-1 text-xs text-emerald-600">
            <CloudUpload class="size-3" />
            auto-backup on
          </p>
        {/if}
        <div class="flex items-center justify-end gap-1">
          {@render volActions(vol)}
        </div>
      </div>
    {/snippet}

    <EntityListView
      {card}
      getKey={(vol) => vol.id}
      items={data.volumes}
      {row}
      viewKey="storage"
    />
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Services using it will need a redeploy.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete volume"
/>
