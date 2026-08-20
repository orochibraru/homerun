<script lang="ts">
	import { ChevronDown, Plus, PlusIcon, Server, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	onMount(() => title.set("Remote Hosts"));

	let showTls = $state(false);
	let submitting = $state(false);

	function confirmDelete(e: SubmitEvent, name: string) {
		if (
			!confirm(
				`Delete "${name}"? Services deployed to it keep running there — they just won't be manageable from here anymore.`,
			)
		) {
			e.preventDefault();
		}
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-text">Remote Hosts</h1>
      <p class="mt-1 text-sm text-text-muted">
        Other Docker daemons a service can be deployed to instead of this host.
        A remote-hosted service isn't on the shared network or routed through
        Traefik — see the docs on the Networking tab for what that means in
        practice.
      </p>
    </div>
    <Button href={resolve("/remote-hosts/new")}>
      <Plus class="size-4" />
      Add Host
    </Button>
  </div>

  {#if data.hosts.length === 0}
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
    <div class="space-y-3">
      {#each data.hosts as host (host.id)}
        <div
          class="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5"
        >
          <div
            class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
          >
            <Server class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-text">
              {host.name}
            </p>
            <p class="mt-0.5 truncate font-mono text-xs text-text-muted">
              {host.dockerHost}
            </p>
          </div>
          <form
            action="?/delete"
            method="POST"
            onsubmit={(e) => confirmDelete(e, host.name)}
            use:enhance={() =>
              async ({ result, update }) => {
                if (result.type === "failure") {
                  toast.error("Couldn't delete the host.");
                }
                await update();
              }}
          >
            <input name="hostId" type="hidden" value={host.id}>
            <Button
              class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
              size="icon-sm"
              title="Delete"
              type="submit"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
