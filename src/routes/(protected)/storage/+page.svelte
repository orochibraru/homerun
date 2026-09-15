<script lang="ts">
	import { CloudUpload, HardDrive, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	onMount(() => title.set("Storage"));

	const view = new ViewMode("storage");

	const filters: FilterGroup[] = [
		{
			key: "kind",
			label: "Kind",
			options: [
				{ label: "Bind mount", value: "bind" },
				{ label: "Docker volume", value: "volume" },
			],
		},
		{
			key: "backup",
			label: "Backups",
			options: [
				{ label: "Enabled", value: "on" },
				{ label: "Disabled", value: "off" },
			],
		},
	];

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Storage</h1>
      <p class="text-text-muted mt-1 text-sm">
        Local volume sources services can mount for persistent or shared data.
      </p>
    </div>
    <Button href={resolve("/storage/new")}>
      <Plus class="size-4" />
      New Volume
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
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

    {#snippet media(_item: { id: string })}
      <span class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
        <HardDrive class="size-4" />
      </span>
    {/snippet}

    {#snippet meta(item: { id: string })}
      {@const vol = data.volumes.find((v) => v.id === item.id)}
      {#if vol?.backupEnabled}
        <span class="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
          <CloudUpload class="size-3" />
          auto-backup on
        </span>
      {/if}
    {/snippet}

    {#snippet actions(item: { id: string })}
      {@const vol = data.volumes.find((v) => v.id === item.id)}
      {#if vol}
        {@render volActions(vol)}
      {/if}
    {/snippet}

    <EntityToolbar {filters} placeholder="Search volumes by name or source…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.volumes.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No volumes match your filters.</p>
      </div>
    {:else}
      <EntityList
        {actions}
        items={data.volumes.map((vol) => ({
          description: vol.description,
          id: vol.id,
          subtitle: `${vol.kind === "bind" ? "bind" : "volume"} · ${vol.source}`,
          title: vol.name,
        }))}
        {media}
        {meta}
        {view}
      />

      <Pagination
        label="volumes"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Services using it will need a redeploy.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete volume"
/>
