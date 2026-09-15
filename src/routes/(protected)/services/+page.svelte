<script lang="ts">
	import {
		FileUp,
		LayoutGridIcon,
		Play,
		Plus,
		RotateCw,
		Server,
		Square,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { SERVICE_STATUS_CONFIG, UNGROUPED_LABEL } from "$lib/constants";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import type { ContainerStatus } from "$lib/types";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	type Svc = (typeof data.services)[number];
	type ServiceAction = "delete" | "restart" | "start" | "stop";

	onMount(() => title.set("Services"));

	const view = new ViewMode("services");

	let selectedIds = $state<string[]>([]);

	const SERVICE_ACTION_LABELS: Record<
		ServiceAction,
		{ done: string; progressive: string; verb: string }
	> = {
		delete: { done: "deleted", progressive: "Deleting", verb: "delete" },
		restart: { done: "restarted", progressive: "Restarting", verb: "restart" },
		start: { done: "started", progressive: "Starting", verb: "start" },
		stop: { done: "stopped", progressive: "Stopping", verb: "stop" },
	};

	const filters = $derived<FilterGroup[]>([
		{
			key: "status",
			label: "Status",
			options: data.facets.statuses.map((status) => ({
				label: SERVICE_STATUS_CONFIG[status as ContainerStatus].label,
				value: status,
			})),
		},
		{
			key: "project",
			label: "Project",
			options: data.facets.projects.map((name) => ({
				label: name,
				value: name,
			})),
		},
	]);

	// Group by project name, "Ungrouped" last : order of first appearance
	// otherwise, matching the underlying createdAt-desc query order.
	const groups = $derived.by(() => {
		const byLabel = new Map<string, Svc[]>();
		for (const svc of data.services) {
			const label = svc.projectName ?? UNGROUPED_LABEL;
			const bucket = byLabel.get(label);
			if (bucket) {
				bucket.push(svc);
			} else {
				byLabel.set(label, [svc]);
			}
		}
		const ungrouped = byLabel.get(UNGROUPED_LABEL);
		byLabel.delete(UNGROUPED_LABEL);
		const entries = [...byLabel.entries()];
		if (ungrouped) {
			entries.push([UNGROUPED_LABEL, ungrouped]);
		}
		return entries;
	});

	const selectedSet = $derived(new Set(selectedIds));
	const visibleIds = $derived(data.services.map((svc) => svc.id));
	const allVisibleSelected = $derived(
		visibleIds.length > 0 && visibleIds.every((id) => selectedSet.has(id)),
	);

	// Selection is scoped to the page you can actually see : paginating (or
	// changing the search/filters) reloads `data.services`, and anything no
	// longer on screen drops out rather than being silently submitted by the
	// bulk bar.
	$effect(() => {
		const existing = new Set(data.services.map((svc) => svc.id));
		if (selectedIds.some((id) => !existing.has(id))) {
			selectedIds = selectedIds.filter((id) => existing.has(id));
		}
	});

	function byId(id: string): Svc | undefined {
		return data.services.find((svc) => svc.id === id);
	}

	function toggleSelected(id: string) {
		selectedIds = selectedSet.has(id)
			? selectedIds.filter((other) => other !== id)
			: [...selectedIds, id];
	}

	function toggleAllVisible() {
		selectedIds = allVisibleSelected ? [] : visibleIds;
	}

	// Tracks which service's action is in flight, keyed by serviceId, so
	// only that row's buttons show a spinner/disable.
	let pending = $state<Record<string, boolean>>({});

	function serviceName(serviceId: string): string {
		return (
			data.services.find((svc) => svc.id === serviceId)?.name ?? "the service"
		);
	}

	function withPending(serviceId: string, action: ServiceAction) {
		const label = SERVICE_ACTION_LABELS[action];
		return enhanceToast({
			error: `Couldn't ${label.verb} ${serviceName(serviceId)}.`,
			loading: `${label.progressive} ${serviceName(serviceId)}`,
			onSettled: () => {
				pending[serviceId] = false;
			},
			onStart: () => {
				pending[serviceId] = true;
			},
			success: `${serviceName(serviceId)} ${label.done}.`,
		});
	}

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}

	let bulkOp = $state<ServiceAction>("start");
	let bulkPending = $state(false);
	let bulkDeleteDialogOpen = $state(false);
	let bulkForm = $state<HTMLFormElement | null>(null);
	let bulkDeleteSubmitter = $state<HTMLButtonElement | null>(null);

	function plural(count: number): string {
		return count === 1 ? "service" : "services";
	}

	const bulkSubmit: import("@sveltejs/kit").SubmitFunction = (input) => {
		const label = SERVICE_ACTION_LABELS[bulkOp];
		const count = selectedIds.length;
		return enhanceToast({
			error: `Couldn't ${label.verb} the selected ${plural(count)}.`,
			loading: `${label.progressive} ${count} ${plural(count)}`,
			onSettled: () => {
				bulkPending = false;
			},
			onStart: () => {
				bulkPending = true;
			},
			onSuccess: () => {
				selectedIds = [];
			},
			success: (result) => {
				const summary = result as
					| { failed?: number; succeeded?: number }
					| undefined;
				const ok = summary?.succeeded ?? count;
				const failed = summary?.failed ?? 0;
				const base = `${ok} ${plural(ok)} ${label.done}`;
				return failed > 0 ? `${base}, ${failed} failed.` : `${base}.`;
			},
		})(input);
	};
</script>

<div class="p-5 md:p-6 {selectedIds.length > 0 ? 'pb-28' : ''}">
  <div class="border-border mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Services</h1>
      <p class="text-text-muted mt-0.5 text-xs">
        Containers deployed to this server.
      </p>
    </div>
    <div class="flex items-center gap-2">
      <Button
        href={resolve("/services/import")}
        size="sm"
        variant="outline"
      >
        <FileUp class="size-4" />
        Import compose
      </Button>
      <Button href={resolve("/services/new")} size="sm">
        <Plus class="size-4" />
        Deploy a Service
      </Button>
    </div>
  </div>

  {#if data.total === 0 && !data.filtered}
    <div class="border-border flex flex-col items-center justify-center rounded-md border border-dashed py-20 text-center">
      <Server class="text-text-muted mb-3 size-10 opacity-40" />
      <p class="text-text-muted text-sm font-medium">No services yet</p>
      <p class="text-text-subtle mt-1 text-xs">
        Point at an image, fill in a config, and deploy.
      </p>
      <div class="flex items-center gap-2">
        <Button class="mt-5" href={resolve("/services/new")} size="sm">
          <Plus class="size-4" />
          Deploy your first service
        </Button>
        <Button
          class="mt-5"
          href={resolve("/templates")}
          size="sm"
          variant="outline"
        >
          <LayoutGridIcon class="size-4" />
          Start from a template
        </Button>
      </div>
    </div>
  {:else}
    <EntityToolbar
      {filters}
      placeholder="Search services by name, image or domain…"
    >
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.services.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No services match your filters.</p>
      </div>
    {:else}
      <div class="mb-4 flex items-center gap-2.5">
        <Checkbox
          aria-label="Select all services"
          checked={allVisibleSelected}
          indeterminate={selectedIds.length > 0 && !allVisibleSelected}
          onCheckedChange={toggleAllVisible}
        />
        <span class="text-text-subtle text-xs">
          {selectedIds.length > 0
          ? `${selectedIds.length} selected`
          : `Select all ${data.services.length} on this page`}
        </span>
      </div>

      {#snippet media(item: { id: string })}
        {@const svc = byId(item.id)}
        <span class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
          <Server class="size-4" />
        </span>
        {#if svc}
          <span class="sr-only">{svc.name}</span>
        {/if}
      {/snippet}

      {#snippet badge(item: { id: string })}
        {@const svc = byId(item.id)}
        {#if svc}
          <StatusBadge status={svc.currentStatus} />
        {/if}
      {/snippet}

      {#snippet actions(item: { id: string })}
        {@const svc = byId(item.id)}
        {#if svc}
        <div class="flex shrink-0 items-center gap-1.5">
          {#if svc.desiredState === "running"}
            <form action="?/stop" method="POST" use:enhance={withPending(svc.id, "stop")}>
              <input name="serviceId" type="hidden" value={svc.id}>
              <Button
                disabled={pending[svc.id]}
                size="icon-sm"
                title="Stop"
                type="submit"
                variant="ghost"
              >
                {#if pending[svc.id]}
                  <Spinner />
                {:else}
                  <Square class="size-4" />
                {/if}
              </Button>
            </form>
          {:else}
            <form action="?/start" method="POST" use:enhance={withPending(svc.id, "start")}>
              <input name="serviceId" type="hidden" value={svc.id}>
              <Button
                disabled={pending[svc.id] || !svc.containerId}
                size="icon-sm"
                title={svc.containerId
                ? "Start"
                : "Deploy first from the service page"}
                type="submit"
                variant="ghost"
              >
                {#if pending[svc.id]}
                  <Spinner />
                {:else}
                  <Play class="size-4" />
                {/if}
              </Button>
            </form>
          {/if}

          <form action="?/restart" method="POST" use:enhance={withPending(svc.id, "restart")}>
            <input name="serviceId" type="hidden" value={svc.id}>
            <Button
              disabled={pending[svc.id] || !svc.containerId}
              size="icon-sm"
              title="Restart"
              type="submit"
              variant="ghost"
            >
              <RotateCw class="size-4" />
            </Button>
          </form>

          <form action="?/delete" method="POST" use:enhance={withPending(svc.id, "delete")}>
            <input name="serviceId" type="hidden" value={svc.id}>
            <Button
              class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
              disabled={pending[svc.id]}
              onclick={(e) => requestDelete(e, svc.name)}
              size="icon-sm"
              title="Delete"
              type="button"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </form>
        </div>
        {/if}
      {/snippet}

      <div class="space-y-6">
        {#each groups as [label, services] (label)}
          <div>
            {#if groups.length > 1}
              <h2 class="eyebrow mb-2">
                {label}
              </h2>
            {/if}
            <EntityList
              {actions}
              items={services.map((svc) => ({
                description: `${svc.image}:${svc.tag}`,
                href: `${resolve("/services")}/${svc.id}`,
                id: svc.id,
                subtitle: `${svc.slug}.${data.baseDomain}`,
                title: svc.name,
              }))}
              onToggleSelect={toggleSelected}
              {badge}
              {media}
              selectedIds={selectedIds}
              {view}
            />
          </div>
        {/each}
      </div>

      <Pagination
        label="services"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}
  {/if}
</div>

{#if selectedIds.length > 0}
  <div class="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
    <form
      action="?/bulk"
      class="panel-strong pointer-events-auto flex flex-wrap items-center gap-2 rounded-md px-4 py-3 shadow-lg"
      method="POST"
      bind:this={bulkForm}
      use:enhance={bulkSubmit}
    >
      {#each selectedIds as id (id)}
        <input name="serviceId" type="hidden" value={id}>
      {/each}
      <button
        class="hidden"
        name="op"
        type="submit"
        value="delete"
        bind:this={bulkDeleteSubmitter}
        aria-hidden="true"
        tabindex="-1"
      ></button>

      <span class="text-text mr-1 text-sm font-medium">
        {selectedIds.length}
        {plural(selectedIds.length)} selected
      </span>

      <Button
        disabled={bulkPending}
        name="op"
        onclick={() => {
          bulkOp = "start";
        }}
        size="sm"
        type="submit"
        value="start"
        variant="outline"
      >
        <Play class="size-3.5" />
        Start
      </Button>
      <Button
        disabled={bulkPending}
        name="op"
        onclick={() => {
          bulkOp = "stop";
        }}
        size="sm"
        type="submit"
        value="stop"
        variant="outline"
      >
        <Square class="size-3.5" />
        Stop
      </Button>
      <Button
        disabled={bulkPending}
        name="op"
        onclick={() => {
          bulkOp = "restart";
        }}
        size="sm"
        type="submit"
        value="restart"
        variant="outline"
      >
        <RotateCw class="size-3.5" />
        Restart
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
      <Button
        disabled={bulkPending}
        onclick={() => {
          selectedIds = [];
        }}
        size="sm"
        type="button"
        variant="ghost"
      >
        Clear
      </Button>
    </form>
  </div>
{/if}

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  confirmPhrase={pendingDeleteName}
  description={`Delete "${pendingDeleteName}"? This removes its container and can't be undone.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete service"
/>

<ConfirmDialog
  bind:open={bulkDeleteDialogOpen}
  confirmLabel="Delete {selectedIds.length} {plural(selectedIds.length)}"
  confirmPhrase="delete {selectedIds.length} {plural(selectedIds.length)}"
  description={`Delete ${selectedIds.length} selected ${plural(selectedIds.length)}? Their containers are removed and this can't be undone.`}
  onConfirm={() => bulkForm?.requestSubmit(bulkDeleteSubmitter ?? undefined)}
  title="Delete selected services"
/>
