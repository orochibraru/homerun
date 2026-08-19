<script lang="ts">
  import { CloudUpload, HardDrive, Plus, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import EmptyState from "$lib/components/empty-state.svelte";
  import { title } from "$lib/store/title";

  const { data } = $props();

  onMount(() => title.set("Storage"));

  function confirmDelete(e: SubmitEvent, name: string) {
    if (
      // biome-ignore lint/suspicious/noAlert: a native confirm() is the simplest correct guard here — no custom UI built for this yet.
      !confirm(`Delete "${name}"? Services using it will need a redeploy.`)
    ) {
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
    <a
      class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
      href={resolve("/storage/new")}
    >
      <Plus class="size-4" />
      New Volume
    </a>
  </div>

  {#if data.volumes.length === 0}
    <EmptyState
      icon={HardDrive}
      subtitle="Create one, then mount it into a service from its Settings tab."
      title="No storage volumes yet"
    >
      {#snippet children()}
        <a
          class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
          href={resolve("/storage/new")}
        >
          <Plus class="size-4" />
          New Volume
        </a>
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
          <a
            class="rounded-lg p-2 text-text-muted transition-all hover:bg-surface-2 hover:text-text"
            href={resolve("/storage/[volumeId]", { volumeId: vol.id })}
            title="Backup settings"
          >
            <CloudUpload class="size-4" />
          </a>
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
            <input name="volumeId" type="hidden" value={vol.id}>
            <button
              class="rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10"
              title="Delete"
              type="submit"
            >
              <Trash2 class="size-4" />
            </button>
          </form>
        </div>
      {/each}
    </div>
  {/if}
</div>
