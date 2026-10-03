<script lang="ts">
	import { Plus, PlusIcon, Server, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityList from "#lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "#lib/components/entity-toolbar.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import ViewModeToggle from "#lib/components/view-mode-toggle.svelte";
	import { BASE_SORTS } from "#lib/list-sorts.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EnrollDialog from "./enroll-dialog.svelte";
	import SwarmNodes from "./swarm-nodes.svelte";

	const { data, form } = $props();

	onMount(() => title.set("Remote Hosts"));

	const view = new ViewMode("remote-hosts");

	const rows = $derived(
		data.hosts.map((host) => ({
			href: resolve("/(protected)/remote-hosts/[hostId]", { hostId: host.id }),
			id: host.id,
			kind: host.kind,
			name: host.name,
			status: data.agentStatuses[host.id],
			subtitle: host.kind === "agent" ? host.agentUrl : host.dockerHost,
			title: host.name,
		})),
	);
	type HostRow = (typeof rows)[number];

	const filters: FilterGroup[] = [
		{
			key: "kind",
			label: "Connection",
			options: [
				{ label: "Docker socket", value: "docker" },
				{ label: "Homerun Agent", value: "agent" },
			],
		},
	];

	let enrollOpen = $state(false);

	let deleteDialogOpen = $state(false);
	let pendingDeleteName = $state("");
	let pendingDeleteForm: HTMLFormElement | null = null;

	function requestDelete(e: MouseEvent, name: string) {
		pendingDeleteForm = (e.currentTarget as HTMLElement).closest("form");
		pendingDeleteName = name;
		deleteDialogOpen = true;
	}
</script>

{#snippet media(host: HostRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    <Server class="size-5" />
  </div>
{/snippet}

{#snippet badge(host: HostRow)}
  {#if host.kind === "agent"}
    <span class="bg-accent-light text-accent shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
      Homerun Agent
    </span>
  {/if}
{/snippet}

{#snippet meta(host: HostRow)}
  {#if host.kind === "agent"}
    <span class="flex items-center gap-1.5 text-xs">
      {#if host.status?.reachable}
        <span class="inline-block size-1.5 rounded-full bg-green-500"></span>
        <span class="text-text-subtle">Online, agent v{host.status.version}</span>
      {:else}
        <span class="inline-block size-1.5 rounded-full bg-red-500"></span>
        <span class="text-red-600 dark:text-red-400">
          Unreachable{host.status?.error ? ` : ${host.status.error}` : ""}
        </span>
      {/if}
    </span>
  {/if}
{/snippet}

{#snippet actions(host: HostRow)}
  <form
    action="?/delete"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't delete the host.",
      loading: "Deleting the host",
      success: "Host deleted.",
    })}
  >
    <input name="hostId" type="hidden" value={host.id} />
    <Button
      class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
      onclick={(e) => requestDelete(e, host.name)}
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
      <h1 class="text-text text-lg font-semibold tracking-tight">Remote Hosts</h1>
      <p class="text-text-muted mt-1 text-sm">
        Build servers git builds can run on, and the swarm nodes swarm services
        are scheduled on. Add a server with one command and it becomes either.
      </p>
    </div>
    <div class="flex gap-2">
      {#if data.isAdmin}
        <Button onclick={() => enrollOpen = true}><Plus class="size-4" />Add a server</Button>
      {/if}

      <Button
        href={resolve('remote-hosts/new')}
        variant="outline"
      >Register by hand</Button>
    </div>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={Server}
      subtitle="Git builds run on this host until you add a build server."
      title="No remote hosts yet"
    ><Button href={resolve('remote-hosts/new')}><PlusIcon />Add your first remote host</Button></EmptyState>
  {:else}
    <EntityToolbar
      sorts={BASE_SORTS}
      filters={filters}
      placeholder="Search hosts by name or address…"
    >
      {#snippet trailing()}
        <ViewModeToggle view={view} />
      {/snippet}
    </EntityToolbar>

    {#if data.hosts.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No hosts match your filters.</p>
      </div>
    {:else}
      <EntityList
        actions={actions}
        badge={badge}
        items={rows}
        media={media}
        meta={meta}
        view={view}
      />

      <Pagination
        label="hosts"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}
  {/if}

  <SwarmNodes enrollments={data.enrollments} nodes={data.swarmNodes} />
</div>

<EnrollDialog bind:open={enrollOpen} swarmMode={data.swarmMode} />

<ConfirmDialog
  bind:open={deleteDialogOpen}
  confirmLabel="Delete"
  description={`Delete "${pendingDeleteName}"? Services that build on it fall back to building on this host.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete remote host"
/>
