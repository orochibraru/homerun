<script lang="ts">
	import { CloudUpload, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	onMount(() => title.set("S3 Destinations"));

	const view = new ViewMode("s3-destinations");

	const rows = $derived(
		data.destinations.map((dest) => ({
			id: dest.id,
			name: dest.name,
			subtitle: `${dest.endpoint} · ${dest.bucket} · ${dest.region}`,
			title: dest.name,
		})),
	);
	type DestinationRow = (typeof rows)[number];

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

{#snippet media(_dest: DestinationRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    <CloudUpload class="size-5" />
  </div>
{/snippet}

{#snippet actions(dest: DestinationRow)}
  <form
    action="?/delete"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't delete : make sure no volume still uses it.",
      loading: "Deleting the destination",
      success: "Destination deleted.",
    })}
  >
    <input name="destinationId" type="hidden" value={dest.id}>
    <Button
      class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
      onclick={(e) => requestDelete(e, dest.name)}
      size="icon-sm"
      title="Delete"
      type="button"
      variant="ghost"
    >
      <Trash2 class="size-4" />
    </Button>
  </form>
{/snippet}

<div class="p-5 md:p-6">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">S3 Destinations</h1>
      <p class="text-text-muted mt-1 text-sm">
        Reusable S3-compatible backup destinations. Pick one from any volume's
        page instead of retyping the same bucket/keys everywhere.
      </p>
    </div>
    <Button href={resolve("/s3-destinations/new")}>
      <Plus class="size-4" />
      Add Destination
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={CloudUpload}
      subtitle="Add one, then pick it from a volume's backup config."
      title="No S3 destinations yet"
    >
      <Button href={resolve("/s3-destinations/new")}>
        <Plus class="size-4" />
        Add your first destination
      </Button>
    </EmptyState>
  {:else}
    <EntityToolbar placeholder="Search destinations by name, endpoint or bucket…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.destinations.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No destinations match your search.</p>
      </div>
    {:else}
    <EntityList {actions} items={rows} {media} {view} />
    <Pagination
      label="destinations"
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
  description={`Delete "${pendingDeleteName}"? Any volume still picking it will fall back to no destination.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete S3 destination"
/>
