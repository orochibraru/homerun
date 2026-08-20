<script lang="ts">
	import { CloudUpload, HardDrive, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Storage"));

	function confirmDelete(e: SubmitEvent, name: string) {
		if (!confirm(`Delete "${name}"? Services using it will need a redeploy.`)) {
			e.preventDefault();
		}
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-text">Storage</h1>
      <p class="mt-1 text-sm text-text-muted">
        Local volume sources services can mount for persistent or shared data.
      </p>
    </div>
    <Button href={resolve("/storage/new")}>
      <Plus class="size-4" />
      New Volume
    </Button>
  </div>

  {#if data.volumes.length === 0}
    <EmptyState
      icon={HardDrive}
      subtitle="Create one, then mount it into a service from its Settings tab."
      title="No storage volumes yet"
    >
      {#snippet children()}
        <Button href={resolve("/storage/new")}>
          <Plus class="size-4" />
          New Volume
        </Button>
      {/snippet}
    </EmptyState>
  {:else}
    <div class="space-y-3">
      {#each data.volumes as vol (vol.id)}
        <div
          class="flex items-center gap-4 rounded-2xl border border-border bg-surface p-5"
        >
          <div
            class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl"
          >
            <HardDrive class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-semibold text-text">
              {vol.name}
            </p>
            <p class="mt-0.5 truncate font-mono text-xs text-text-muted">
              {vol.kind === "bind" ? "bind" : "volume"}
              · {vol.source}
            </p>
            {#if vol.description}
              <p class="mt-0.5 truncate text-xs text-text-subtle">
                {vol.description}
              </p>
            {/if}
            {#if vol.backupEnabled}
              <p
                class="mt-0.5 flex items-center gap-1 text-xs text-emerald-600"
              >
                <CloudUpload class="size-3" />
                auto-backup on
              </p>
            {/if}
          </div>
          <Button
            href={resolve("/(protected)/storage/[volumeId]", {
              volumeId: vol.id,
            })}
            size="icon-sm"
            title="Backup settings"
            variant="ghost"
          >
            <CloudUpload class="size-4" />
          </Button>
          <form
            action="?/delete"
            method="POST"
            onsubmit={(e) => confirmDelete(e, vol.name)}
            use:enhance={() =>
              async ({ result, update }) => {
                if (result.type === "failure") {
                  toast.error("Couldn't delete the volume.");
                }
                await update();
              }}
          >
            <input name="volumeId" type="hidden" value={vol.id} />
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
