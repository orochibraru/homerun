<script lang="ts">
	import { ChevronDown, Plus, PlusIcon, Server, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Remote Hosts"));

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

	let showTls = $state(false);
	let submitting = $state(false);

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
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Remote Hosts</h1>
      <p class="text-text-muted mt-1 text-sm">
        Other Docker daemons a service can be deployed to instead of this host.
        A remote-hosted service isn't on the shared network or routed through
        Traefik : see the docs on the Networking tab for what that means in
        practice.
      </p>
    </div>
    <Button href={resolve("/remote-hosts/new")}>
      <Plus class="size-4" />
      Add Host
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={Server}
      subtitle="Every service deploys to this host until you add one."
      title="No remote hosts yet"
    >
      <Button href={resolve("/remote-hosts/new")}>
        <PlusIcon />
        Add your first remote host
      </Button>
    </EmptyState>
  {:else}
    <EntityToolbar {filters} placeholder="Search hosts by name or address…" />

    {#if data.hosts.length === 0}
      <div class="border-border/70 rounded-2xl border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No hosts match your filters.</p>
      </div>
    {:else}
    <div class="space-y-3">
      {#each data.hosts as host (host.id)}
        <div class="glass flex items-center gap-4 rounded-2xl p-5">
          <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
            <Server class="size-5" />
          </div>
          <a
            class="min-w-0 flex-1"
            href={resolve("/(protected)/remote-hosts/[hostId]", {
              hostId: host.id,
            })}
          >
            <p class="text-text truncate text-sm font-semibold hover:underline">
              {host.name}
              {#if host.kind === "agent"}
                <span class="ml-1.5 rounded-full bg-accent-light px-2 py-0.5 text-[0.65rem] font-semibold text-accent">
                  Homerun Agent
                </span>
              {/if}
              {#if host.isBuildServer}
                <span class="ml-1.5 rounded-full bg-accent-light px-2 py-0.5 text-[0.65rem] font-semibold text-accent">
                  Build server
                </span>
              {/if}
            </p>
            <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
              {host.kind === "agent" ? host.agentUrl : host.dockerHost}
            </p>
            {#if host.kind === "agent"}
              {@const status = data.agentStatuses[host.id]}
              <p class="mt-0.5 flex items-center gap-1.5 text-xs">
                {#if status?.reachable}
                  <span class="inline-block size-1.5 rounded-full bg-green-500"></span>
                  <span class="text-text-subtle">
                    Online, agent v{status.version}
                  </span>
                {:else}
                  <span class="inline-block size-1.5 rounded-full bg-red-500"></span>
                  <span class="text-red-600 dark:text-red-400">
                    Unreachable{status?.error ? ` : ${status.error}` : ""}
                  </span>
                {/if}
              </p>
            {/if}
          </a>
          <form
            action="?/delete"
            method="POST"
            use:enhance={enhanceToast({
              error: "Couldn't delete the host.",
              loading: "Deleting the host",
              success: "Host deleted.",
            })}
          >
            <input name="hostId" type="hidden" value={host.id}>
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
        </div>
      {/each}
    </div>
    <Pagination
      label="hosts"
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
  description={`Delete "${pendingDeleteName}"? Services deployed to it keep running there : they just won't be manageable from here anymore.`}
  onConfirm={() => pendingDeleteForm?.requestSubmit()}
  title="Delete remote host"
/>
