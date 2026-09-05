<script lang="ts">
	import {
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
	import EntityListView from "$lib/components/entity-list-view.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	onMount(() => title.set("Services"));

	// Group by project name, "Ungrouped" last : order of first appearance
	// otherwise, matching the underlying createdAt-desc query order.
	const groups = $derived.by(() => {
		const byLabel = new Map<string, typeof data.services>();
		for (const svc of data.services) {
			const label = svc.projectName ?? "Ungrouped";
			const bucket = byLabel.get(label);
			if (bucket) {
				bucket.push(svc);
			} else {
				byLabel.set(label, [svc]);
			}
		}
		const ungrouped = byLabel.get("Ungrouped");
		byLabel.delete("Ungrouped");
		const entries = [...byLabel.entries()];
		if (ungrouped) {
			entries.push(["Ungrouped", ungrouped]);
		}
		return entries;
	});

	// Tracks which service's action is in flight, keyed by serviceId, so
	// only that row's buttons show a spinner/disable.
	let pending = $state<Record<string, boolean>>({});

	type ServiceAction = "delete" | "restart" | "start" | "stop";

	const SERVICE_ACTION_LABELS: Record<
		ServiceAction,
		{ done: string; progressive: string; verb: string }
	> = {
		delete: { done: "deleted", progressive: "Deleting", verb: "delete" },
		restart: { done: "restarted", progressive: "Restarting", verb: "restart" },
		start: { done: "started", progressive: "Starting", verb: "start" },
		stop: { done: "stopped", progressive: "Stopping", verb: "stop" },
	};

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
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Services</h1>
      <p class="text-text-muted mt-1 text-sm">
        Containers deployed to this server.
      </p>
    </div>
    <Button href={resolve("/services/new")} size="sm">
      <Plus class="size-4" />
      Deploy a Service
    </Button>
  </div>

  {#if data.services.length === 0}
    <div class="border-border flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-center">
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
    {#snippet actions(svc: (typeof data.services)[number])}
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
    {/snippet}

    {#snippet row(svc: (typeof data.services)[number])}
      <div class="glass flex flex-wrap items-center justify-between gap-4 rounded-2xl p-5 transition-shadow hover:shadow-md">
        <a
          class="flex min-w-0 flex-1 items-center gap-4"
          href="{resolve('/services')}/{svc.id}"
        >
          <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Server class="size-5" />
          </div>
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-text truncate text-sm font-semibold">
                {svc.name}
              </p>
              <StatusBadge status={svc.currentStatus} />
            </div>
            <p class="text-text-subtle mt-0.5 truncate font-mono text-xs">
              {svc.image}:{svc.tag}
              · {svc.slug}.{data.baseDomain}
            </p>
          </div>
        </a>
        {@render actions(svc)}
      </div>
    {/snippet}

    {#snippet card(svc: (typeof data.services)[number])}
      <div class="glass glass-interactive flex flex-col gap-3 rounded-2xl p-5">
        <a class="flex min-w-0 items-center gap-3" href="{resolve('/services')}/{svc.id}">
          <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Server class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-semibold">{svc.name}</p>
            <p class="text-text-subtle truncate font-mono text-xs">
              {svc.slug}.{data.baseDomain}
            </p>
          </div>
        </a>
        <p class="text-text-subtle truncate font-mono text-xs">{svc.image}:{svc.tag}</p>
        <div class="flex items-center justify-between gap-2">
          <StatusBadge status={svc.currentStatus} />
          {@render actions(svc)}
        </div>
      </div>
    {/snippet}

    <div class="space-y-8">
      {#each groups as [label, services] (label)}
        <div>
          {#if groups.length > 1}
            <h2 class="eyebrow mb-3">
              {label}
            </h2>
          {/if}
          <EntityListView
            {card}
            getKey={(svc) => svc.id}
            items={services}
            {row}
            viewKey="services"
          />
        </div>
      {/each}
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? This removes its container and can't be undone.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete service"
/>
