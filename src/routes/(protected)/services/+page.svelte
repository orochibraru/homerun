<script lang="ts">
	import { FileUp, LayoutGridIcon, Plus, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EntityList, {
		type EntityRow,
	} from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import SelectAllRow from "$lib/components/select-all-row.svelte";
	import ServiceContextMenu from "$lib/components/service-context-menu.svelte";
	import ServiceMenuHost from "$lib/components/service-menu-host.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { SERVICE_STATUS_CONFIG, UNGROUPED_LABEL } from "$lib/constants";
	import { ListSelection } from "$lib/list-selection.svelte";
	import { syncServiceStatuses } from "$lib/remote/service-status.remote";
	import {
		SERVICE_ACTION_LABELS,
		type ServiceAction,
	} from "$lib/service-actions";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import type { ContainerStatus } from "$lib/types";
	import { ViewMode } from "$lib/view-mode.svelte";
	import BulkBar from "./bulk-bar.svelte";
	import ServiceRowActions from "./service-row-actions.svelte";

	const { data } = $props();

	type Svc = (typeof data.services)[number];

	onMount(() => title.set("Services"));

	const view = new ViewMode("services");

	const selection = new ListSelection(() => data.services.map((svc) => svc.id));

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
			key: "stack",
			label: "Stack",
			options: data.facets.stacks.map((name) => ({
				label: name,
				value: name,
			})),
		},
	]);

	// Group by stack name, "Ungrouped" last : order of first appearance
	// otherwise, matching the underlying createdAt-desc query order.
	const groups = $derived.by(() => {
		const byLabel = new Map<string, Svc[]>();
		for (const svc of data.services) {
			const label = svc.stackName ?? UNGROUPED_LABEL;
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

	const deployedIds = $derived(
		data.services
			.filter((svc) => svc.containerId || svc.swarmServiceId)
			.map((svc) => svc.id),
	);
	const synced = $derived(syncServiceStatuses(deployedIds));
	const liveStatus = $derived(
		new Map((synced.current ?? []).map((row) => [row.id, row.status])),
	);

	function statusOf(svc: Svc): ContainerStatus {
		return liveStatus.get(svc.id) ?? svc.currentStatus;
	}

	function byId(id: string): Svc | undefined {
		return data.services.find((svc) => svc.id === id);
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

	let menuHost = $state<ReturnType<typeof ServiceMenuHost>>();
</script>

<div class="p-5 md:p-6 {selection.count > 0 ? 'pb-28' : ''}">
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
      <SelectAllRow
        noun="services"
        {selection}
        visibleCount={data.services.length}
      />

      {#snippet wrapper(item: EntityRow, body: import("svelte").Snippet)}
        {@const svc = byId(item.id)}
        {#if svc}
          <ServiceContextMenu
            onaction={(op, id) => menuHost?.run(op, id)}
            ongroup={(s) => menuHost?.group(s)}
            onlink={(s) => menuHost?.link(s)}
            onungroup={(s) => menuHost?.ungroup(s)}
            service={svc}
          >
            {@render body()}
          </ServiceContextMenu>
        {:else}
          {@render body()}
        {/if}
      {/snippet}

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
          <StatusBadge status={statusOf(svc)} />
        {/if}
      {/snippet}

      {#snippet actions(item: { id: string })}
        {@const svc = byId(item.id)}
        {#if svc}
          <ServiceRowActions
            ondelete={(e) => requestDelete(e, svc.name)}
            pending={pending[svc.id] ?? false}
            service={svc}
            submit={(action) => withPending(svc.id, action)}
          />
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
              {wrapper}
              items={services.map((svc) => ({
                description: `${svc.image}:${svc.tag}`,
                href: `${resolve("/services")}/${svc.id}`,
                id: svc.id,
                subtitle: `${svc.slug}.${data.baseDomain}`,
                title: svc.name,
              }))}
              onToggleSelect={(id) => selection.toggle(id)}
              {badge}
              {media}
              selectedIds={selection.ids}
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

<BulkBar {selection} />

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  confirmPhrase={pendingDeleteName}
  description={`Delete "${pendingDeleteName}"? This removes its container and can't be undone.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete service"
/>

<ServiceMenuHost
  bind:this={menuHost}
  services={data.services}
  stacks={data.stacks}
/>
