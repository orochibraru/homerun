<script lang="ts">
	import { ArrowRightLeft, Pencil, Plus, Trash2 } from "@lucide/svelte";
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

	onMount(() => title.set("Redirects"));

	const view = new ViewMode("redirects");

	const rows = $derived(
		data.redirects.map((item) => ({
			enabled: item.enabled,
			href: resolve("/(protected)/redirects/[redirectId]", {
				redirectId: item.id,
			}),
			id: item.id,
			name: item.source,
			subtitle: [
				`→ ${item.destination}`,
				item.permanent ? "permanent" : "temporary",
				item.keepPath ? "keeps path" : "fixed destination",
			].join(" · "),
			title: item.source,
		})),
	);
	type RedirectRow = (typeof rows)[number];

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

{#snippet media(_item: RedirectRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    <ArrowRightLeft class="size-5" />
  </div>
{/snippet}

{#snippet badge(item: RedirectRow)}
  {#if !item.enabled}
    <span class="bg-surface-2 text-text-subtle shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
      Disabled
    </span>
  {/if}
{/snippet}

{#snippet actions(item: RedirectRow)}
  <Button href={item.href} size="icon-sm" title="Edit" variant="ghost">
    <Pencil class="size-4" />
  </Button>
  <form
    action="?/delete"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't delete the redirect.",
      loading: "Deleting the redirect",
      success: "Redirect deleted.",
    })}
  >
    <input name="redirectId" type="hidden" value={item.id}>
    <Button
      class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
      onclick={(e) => requestDelete(e, item.name)}
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
  <div class="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Redirects</h1>
      <p class="text-text-muted mt-1 text-sm">
        Send a hostname, or a path under it, to another URL. Served by
        Traefik, no container involved.
      </p>
    </div>
    <Button href={resolve("/redirects/new")}>
      <Plus class="size-4" />
      Add Redirect
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={ArrowRightLeft}
      subtitle="Add one to send an old domain or path to its new home."
      title="No redirects yet"
    >
      <Button href={resolve("/redirects/new")}>
        <Plus class="size-4" />
        Add your first redirect
      </Button>
    </EmptyState>
  {:else}
    <EntityToolbar
      placeholder="Search redirects by source or destination…"
      sorts={BASE_SORTS}
    >
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.redirects.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No redirects match your search.</p>
      </div>
    {:else}
      <EntityList {actions} {badge} items={rows} {media} {view} />
      <Pagination
        label="redirects"
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
  description={`Delete the redirect for "${pendingDeleteName}"? Requests to it will stop being redirected.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete redirect"
/>
