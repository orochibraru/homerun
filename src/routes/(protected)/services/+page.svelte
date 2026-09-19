<script lang="ts">
	import {
		FileUp,
		LayoutGridIcon,
		Link2,
		Play,
		Plus,
		RotateCw,
		Server,
		Square,
		Trash2,
	} from "@lucide/svelte";
	import { onMount, tick } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import BulkActionBar from "$lib/components/bulk-action-bar.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EntityList, {
		type EntityRow,
	} from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import Pagination from "$lib/components/pagination.svelte";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import SelectAllRow from "$lib/components/select-all-row.svelte";
	import ServiceContextMenu from "$lib/components/service-context-menu.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { SERVICE_STATUS_CONFIG, UNGROUPED_LABEL } from "$lib/constants";
	import { ListSelection } from "$lib/list-selection.svelte";
	import { syncServiceStatuses } from "$lib/remote/service-status.remote";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import type { ContainerStatus } from "$lib/types";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	type Svc = (typeof data.services)[number];
	type ServiceAction = "delete" | "restart" | "start" | "stop";

	onMount(() => title.set("Services"));

	const view = new ViewMode("services");

	const selection = new ListSelection(() => data.services.map((svc) => svc.id));

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
		const count = selection.count;
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
				selection.clear();
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

	// Context-menu state. The menu itself is per row; the two dialogs it can
	// open are page-level, so only one of each exists in the DOM.
	let linkOpen = $state(false);
	let groupOpen = $state(false);
	let menuService = $state<Svc | null>(null);
	let linkTargetId = $state("");
	let linkFormat = $state<"url" | "jdbc" | "vars">("url");
	let groupStackId = $state("");
	let newStackName = $state("");
	let linkForm = $state<HTMLFormElement | null>(null);
	let groupForm = $state<HTMLFormElement | null>(null);
	let ungroupForm = $state<HTMLFormElement | null>(null);

	let alsoGroup = $state(true);

	// Names the stack they'd land in, so the checkbox says what it does
	// rather than making you guess which one wins.
	const groupHint = $derived.by(() => {
		const target = data.services.find((svc) => svc.id === linkTargetId);
		const existingId = menuService?.stackId ?? target?.stackId ?? null;
		if (existingId) {
			const name =
				data.stacks.find((stack) => stack.id === existingId)?.name ??
				"that stack";
			return `Moves both into ${name}, where they reach each other by slug.`;
		}
		return menuService
			? `Creates a stack named "${menuService.name}" and moves both into it, so they reach each other by slug.`
			: "They only reach each other by slug once they share a stack network.";
	});

	const linkCandidates = $derived(
		data.services.filter((svc) => svc.id !== menuService?.id),
	);

	function openLink(svc: { id: string }) {
		menuService = byId(svc.id) ?? null;
		linkTargetId = "";
		linkFormat = "url";
		linkOpen = true;
	}

	function openGroup(svc: { id: string }) {
		menuService = byId(svc.id) ?? null;
		groupStackId = menuService?.stackId ?? "";
		newStackName = "";
		groupOpen = true;
	}

	function ungroup(svc: { id: string }) {
		menuService = byId(svc.id) ?? null;
		void tick().then(() => ungroupForm?.requestSubmit());
	}

	function runRowAction(
		op: "delete" | "restart" | "start" | "stop",
		id: string,
	) {
		const svc = byId(id);
		if (!svc) {
			return;
		}
		if (op === "delete") {
			menuService = svc;
			pendingDeleteName = svc.name;
			void tick().then(() => {
				pendingDeleteForm = document.querySelector<HTMLFormElement>(
					`form[data-row-action="delete"][data-service="${id}"]`,
				);
				deleteDialogOpen = true;
			});
			return;
		}
		const form = document.querySelector<HTMLFormElement>(
			`form[data-row-action="${op}"][data-service="${id}"]`,
		);
		form?.requestSubmit();
	}
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
            onaction={runRowAction}
            ongroup={openGroup}
            onlink={openLink}
            onungroup={ungroup}
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
        <div class="flex shrink-0 items-center gap-1.5">
          {#if svc.desiredState === "running"}
            <form
              action="?/stop"
              data-row-action="stop"
              data-service={svc.id}
              method="POST"
              use:enhance={withPending(svc.id, "stop")}
            >
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
            <form
              action="?/start"
              data-row-action="start"
              data-service={svc.id}
              method="POST"
              use:enhance={withPending(svc.id, "start")}
            >
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

          <form
            action="?/restart"
            data-row-action="restart"
            data-service={svc.id}
            method="POST"
            use:enhance={withPending(svc.id, "restart")}
          >
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

          <form
            action="?/delete"
            data-row-action="delete"
            data-service={svc.id}
            method="POST"
            use:enhance={withPending(svc.id, "delete")}
          >
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

<BulkActionBar
  action="?/bulk"
  idField="serviceId"
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
</BulkActionBar>

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
  confirmLabel="Delete {selection.count} {plural(selection.count)}"
  confirmPhrase="delete {selection.count} {plural(selection.count)}"
  description={`Delete ${selection.count} selected ${plural(selection.count)}? Their containers are removed and this can't be undone.`}
  onConfirm={() => bulkForm?.requestSubmit(bulkDeleteSubmitter ?? undefined)}
  title="Delete selected services"
/>

<form
  action="?/group"
  method="POST"
  bind:this={ungroupForm}
  use:enhance={enhanceToast({
    error: "Couldn't ungroup the service.",
    loading: "Ungrouping",
    success: "Removed from its stack.",
  })}
>
  <input name="serviceId" type="hidden" value={menuService?.id ?? ""}>
  <input name="stackId" type="hidden" value="">
</form>

<ResponsiveDialog
  description="Writes the connection variables for the service you pick into this service's own environment. Takes effect on its next deploy."
  size="sm"
  title="Link {menuService?.name ?? 'service'}"
  bind:open={linkOpen}
>
  <form
    action="?/link"
    class="space-y-4"
    method="POST"
    bind:this={linkForm}
    use:enhance={enhanceToast({
      error: "Couldn't link the services.",
      loading: "Linking",
      onSuccess: () => {
        linkOpen = false;
      },
      success: (result) => {
        const data = result as
          | { grouped?: boolean; linked?: string[] }
          | undefined;
        const keys = data?.linked ?? [];
        const vars = keys.length > 0 ? `Added ${keys.join(", ")}` : "Linked";
        return data?.grouped ? `${vars}, and grouped them.` : `${vars}.`;
      },
    })}
  >
    <input name="serviceId" type="hidden" value={menuService?.id ?? ""}>
    <div>
      <label class={label} for="targetId">Link to</label>
      <SelectRoot name="targetId" type="single" bind:value={linkTargetId}>
        <SelectTrigger class="w-full" id="targetId">
          {linkCandidates.find((svc) => svc.id === linkTargetId)?.name
          ?? "Select a service"}
        </SelectTrigger>
        <SelectContent>
          {#each linkCandidates as svc (svc.id)}
            <SelectItem label="{svc.name} ({svc.image})" value={svc.id} />
          {/each}
        </SelectContent>
      </SelectRoot>
    </div>
    <div>
      <label class={label} for="format">Inject as</label>
      <SelectRoot name="format" type="single" bind:value={linkFormat}>
        <SelectTrigger class="w-full" id="format">
          {linkFormat === "jdbc"
          ? "JDBC URL"
          : linkFormat === "vars"
            ? "Separate variables"
            : "Connection URL"}
        </SelectTrigger>
        <SelectContent>
          <SelectItem label="Connection URL" value="url" />
          <SelectItem label="JDBC URL" value="jdbc" />
          <SelectItem label="Separate variables" value="vars" />
        </SelectContent>
      </SelectRoot>
    </div>
    <CheckBox
      helperText={groupHint}
      id="alsoGroup"
      label="Also put them in the same stack"
      name="alsoGroup"
      bind:checked={alsoGroup}
    />

    <div class="flex justify-end gap-2">
      <Button disabled={!linkTargetId} type="submit">
        <Link2 class="size-4" />
        Link
      </Button>
    </div>
  </form>
</ResponsiveDialog>

<ResponsiveDialog
  description="Services in one stack share a Docker network and reach each other by slug."
  size="sm"
  title="Group {menuService?.name ?? 'service'}"
  bind:open={groupOpen}
>
  <form
    action="?/group"
    class="space-y-4"
    method="POST"
    bind:this={groupForm}
    use:enhance={enhanceToast({
      error: "Couldn't move the service.",
      loading: "Moving the service",
      onSuccess: () => {
        groupOpen = false;
      },
      success: "Moved.",
    })}
  >
    <input name="serviceId" type="hidden" value={menuService?.id ?? ""}>
    {#if data.stacks.length > 0}
      <div>
        <label class={label} for="stackId">Existing stack</label>
        <SelectRoot name="stackId" type="single" bind:value={groupStackId}>
          <SelectTrigger class="w-full" id="stackId">
            {data.stacks.find((stack) => stack.id === groupStackId)?.name
            ?? "Select a stack"}
          </SelectTrigger>
          <SelectContent>
            {#each data.stacks as stack (stack.id)}
              <SelectItem label={stack.name} value={stack.id} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>
      <p class="text-text-subtle text-center text-xs">or</p>
    {/if}
    <div>
      <label class={label} for="newStackName">New stack</label>
      <Input
        id="newStackName"
        name="newStackName"
        placeholder="Acme"
        type="text"
        bind:value={newStackName}
      />
    </div>
    <div class="flex justify-end gap-2">
      <Button disabled={!(groupStackId || newStackName)} type="submit">
        Move
      </Button>
    </div>
  </form>
</ResponsiveDialog>
