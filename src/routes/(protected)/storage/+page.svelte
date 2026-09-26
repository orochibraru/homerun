<script lang="ts">
	import {
		CloudOff,
		CloudUpload,
		FolderOpen,
		HardDrive,
		Plus,
		Trash2,
	} from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import BulkActionBar from "$lib/components/bulk-action-bar.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import SelectAllRow from "$lib/components/select-all-row.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { ListSelection } from "$lib/list-selection.svelte";
	import { BASE_SORTS } from "$lib/list-sorts";
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

	const selection = new ListSelection(() => data.volumes.map((vol) => vol.id));

	type BulkOp = "delete" | "disableBackup" | "enableBackup";

	const BULK_LABELS: Record<
		BulkOp,
		{ done: string; error: string; progressive: string }
	> = {
		delete: {
			done: "deleted",
			error: "delete",
			progressive: "Deleting",
		},
		disableBackup: {
			done: "no longer backed up",
			error: "turn off backups for",
			progressive: "Turning off backups for",
		},
		enableBackup: {
			done: "now backed up",
			error: "turn on backups for",
			progressive: "Turning on backups for",
		},
	};

	let bulkOp = $state<BulkOp>("enableBackup");
	let bulkPending = $state(false);
	let bulkDeleteDialogOpen = $state(false);
	let bulkForm = $state<HTMLFormElement | null>(null);
	let bulkDeleteSubmitter = $state<HTMLButtonElement | null>(null);

	function plural(count: number): string {
		return count === 1 ? "volume" : "volumes";
	}

	const bulkSubmit: SubmitFunction = (input) => {
		const label = BULK_LABELS[bulkOp];
		const count = selection.count;
		return enhanceToast({
			error: `Couldn't ${label.error} the selected ${plural(count)}.`,
			loading: `${label.progressive} ${count} ${plural(count)}`,
			onSettled: () => {
				bulkPending = false;
			},
			onStart: () => {
				bulkPending = true;
			},
			onSuccess: () => {
				selection.clear();
			},
			success: (result) => {
				const summary = result as
					| { failed?: number; skipped?: number; succeeded?: number }
					| undefined;
				const ok = summary?.succeeded ?? count;
				const parts = [`${ok} ${plural(ok)} ${label.done}`];
				if (summary?.skipped) {
					parts.push(
						`${summary.skipped} skipped (set a schedule and S3 destination first)`,
					);
				}
				if (summary?.failed) {
					parts.push(`${summary.failed} failed`);
				}
				return `${parts.join(", ")}.`;
			},
		})(input);
	};

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

<div class="p-5 md:p-6 {selection.count > 0 ? 'pb-28' : ''}">
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
        href={resolve("/(protected)/storage/[volumeId]/files", {
          volumeId: vol.id,
        })}
        size="icon-sm"
        title="Browse files"
        variant="ghost"
      >
        <FolderOpen class="size-4" />
      </Button>
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

    <EntityToolbar
    sorts={BASE_SORTS} {filters} placeholder="Search volumes by name or source…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.volumes.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No volumes match your filters.</p>
      </div>
    {:else}
      <SelectAllRow
        noun="volumes"
        {selection}
        visibleCount={data.volumes.length}
      />

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
        onToggleSelect={(id) => selection.toggle(id)}
        selectedIds={selection.ids}
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

<BulkActionBar
  action="?/bulk"
  idField="volumeId"
  label={plural(selection.count)}
  pending={bulkPending}
  {selection}
  submit={bulkSubmit}
  bind:form={bulkForm}
>
  <button
    class="hidden"
    name="op"
    type="submit"
    value="delete"
    bind:this={bulkDeleteSubmitter}
    aria-hidden="true"
    tabindex="-1"
  ></button>
  <Button
    disabled={bulkPending}
    name="op"
    onclick={() => {
      bulkOp = "enableBackup";
    }}
    size="sm"
    type="submit"
    value="enableBackup"
    variant="outline"
  >
    <CloudUpload class="size-3.5" />
    Enable backups
  </Button>
  <Button
    disabled={bulkPending}
    name="op"
    onclick={() => {
      bulkOp = "disableBackup";
    }}
    size="sm"
    type="submit"
    value="disableBackup"
    variant="outline"
  >
    <CloudOff class="size-3.5" />
    Disable backups
  </Button>
  <Button
    disabled={bulkPending}
    onclick={() => {
      bulkOp = "delete";
      bulkDeleteDialogOpen = true;
    }}
    size="sm"
    type="button"
    variant="destructive"
  >
    <Trash2 class="size-3.5" />
    Delete
  </Button>
</BulkActionBar>

<ConfirmDialog
  bind:open={bulkDeleteDialogOpen}
  confirmLabel="Delete {selection.count} {plural(selection.count)}"
  description={`Delete ${selection.count} selected ${plural(selection.count)}? Services using them will need a redeploy.`}
  onConfirm={() => bulkForm?.requestSubmit(bulkDeleteSubmitter ?? undefined)}
  title="Delete selected volumes"
/>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Services using it will need a redeploy.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete volume"
/>
