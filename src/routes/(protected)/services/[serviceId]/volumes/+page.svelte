<script lang="ts">
  import { HardDrive, Plus, X } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import CheckBox from "$lib/components/check-box.svelte";
  import { title } from "$lib/store/title";

  const { data } = $props();

  onMount(() => title.set("Volumes"));
</script>

<section class="rounded-2xl border border-border bg-surface">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div
      class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
    >
      <HardDrive class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-text">Volumes</h2>
      <p class="text-xs text-text-muted">
        Mount a storage volume into the container. Takes effect on the next
        deploy.
      </p>
    </div>
  </div>

  {#if data.mounts.length > 0}
    <div class="divide-y divide-border border-b border-border">
      {#each data.mounts as mount (mount.id)}
        <div class="flex items-center gap-3 px-5 py-3">
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-text">
              {mount.volumeName}
              {#if mount.readOnly}
                <span class="text-xs font-normal text-text-subtle"
                  >(read-only)</span
                >
              {/if}
            </p>
            <p class="truncate font-mono text-xs text-text-muted">
              {mount.containerPath}
            </p>
          </div>
          <form
            action="?/detachVolume"
            method="POST"
            use:enhance={() =>
              async ({ result, update }) => {
                if (result.type === "failure") {
                  toast.error("Couldn't remove the mount.");
                }
                await update();
              }}
          >
            <input name="mountId" type="hidden" value={mount.id}>
            <button
              class="rounded-lg p-2 text-text-muted transition-all hover:bg-surface-2 hover:text-text"
              title="Remove"
              type="submit"
            >
              <X class="size-4" />
            </button>
          </form>
        </div>
      {/each}
    </div>
  {/if}

  <div class="p-5">
    {#if data.volumes.length === 0}
      <p class="text-xs text-text-subtle">
        No storage volumes yet —
        <a class="text-accent underline" href={resolve("/storage/new")}
          >create one</a
        >
        first.
      </p>
    {:else}
      <form
        action="?/attachVolume"
        class="flex flex-wrap items-end gap-3"
        method="POST"
        use:enhance={() =>
          async ({ result, update }) => {
            if (result.type === "failure") {
              toast.error("Couldn't mount the volume.");
            }
            await update();
          }}
      >
        <div class="flex-1">
          <label
            class="mb-1.5 block text-xs font-medium text-text"
            for="volumeId"
          >
            Volume
          </label>
          <select
            class="rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-accent"
            id="volumeId"
            name="volumeId"
          >
            {#each data.volumes as vol (vol.id)}
              <option value={vol.id}>{vol.name}</option>
            {/each}
          </select>
        </div>
        <div class="flex-1">
          <label
            class="mb-1.5 block text-xs font-medium text-text"
            for="containerPath"
          >
            Mount path
          </label>
          <input
            class="w-full rounded-xl border border-border bg-surface px-3 py-2 font-mono text-sm text-text placeholder:text-text-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            id="containerPath"
            name="containerPath"
            placeholder="/data"
            required
            type="text"
          >
        </div>
        <div class="w-full sm:w-auto">
          <CheckBox
            checked={false}
            helperText="Mount this volume without write access"
            id="readOnly"
            label="Read-only"
            name="readOnly"
          />
        </div>
        <button
          class="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2"
          type="submit"
        >
          <Plus class="size-3.5" />
          Mount
        </button>
      </form>
    {/if}
  </div>
</section>
