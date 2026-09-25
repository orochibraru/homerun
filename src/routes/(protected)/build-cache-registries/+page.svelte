<script lang="ts">
	import { Container, Pencil, Plus, Trash2 } from "@lucide/svelte";
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
	import { BASE_SORTS } from "$lib/list-sorts";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	onMount(() => title.set("Build Cache Registries"));

	const view = new ViewMode("build-cache-registries");

	const rows = $derived(
		data.registries.map((reg) => ({
			href: resolve("/(protected)/build-cache-registries/[registryId]", {
				registryId: reg.id,
			}),
			id: reg.id,
			name: reg.name,
			subtitle: `${reg.registryUrl} · ${reg.username}`,
			title: reg.name,
		})),
	);
	type RegistryRow = (typeof rows)[number];

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

{#snippet media(_reg: RegistryRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    <Container class="size-5" />
  </div>
{/snippet}

{#snippet actions(reg: RegistryRow)}
  <Button href={reg.href} size="icon-sm" title="Edit" variant="ghost">
    <Pencil class="size-4" />
  </Button>
  <form
    action="?/delete"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't delete : make sure no service still uses it.",
      loading: "Deleting the registry",
      success: "Registry deleted.",
    })}
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
{/snippet}

<div class="p-5 md:p-6">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Build Cache Registries</h1>
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

  {#if data.total === 0 && !data.filtered}
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
    <EntityToolbar
    sorts={BASE_SORTS} placeholder="Search registries by name, URL or username…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.registries.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No registries match your search.</p>
      </div>
    {:else}
    <EntityList {actions} items={rows} {media} {view} />
    <Pagination
      label="registries"
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
  description={`Delete "${pendingDeleteName}"? Any service still picking it will fall back to no build cache.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete build cache registry"
/>
