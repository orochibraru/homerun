<script lang="ts">
  import { HardDrive, Plus, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
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
    <a
      class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
      href={resolve("/storage/new")}
    >
      <Plus class="size-4" />
      New Volume
    </a>
  </div>

  {#if data.volumes.length === 0}
    <div
      class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center"
    >
      <HardDrive class="mb-3 size-10 text-text-muted opacity-40" />
      <p class="text-sm font-medium text-text-muted">No storage volumes yet</p>
      <p class="mt-1 text-xs text-text-subtle">
        Create one, then mount it into a service from its Settings tab.
      </p>
      <a
        class="bg-accent shadow-accent/30 hover:bg-accent-dark mt-5 flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all"
        href={resolve("/storage/new")}
      >
        <Plus class="size-4" />
        New Volume
      </a>
    </div>
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
          </div>
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
