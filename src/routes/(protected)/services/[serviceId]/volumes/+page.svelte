<script lang="ts">
	import { HardDrive, Plus, X } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import CheckBox from "$lib/components/check-box.svelte";
	import NewVolumeFields from "$lib/components/new-volume-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	let volumeId = $state("");

	const { data } = $props();

	onMount(() => title.set("Volumes"));

	let newVolumeOpen = $state(false);
	let newVolumeKind = $state<"bind" | "volume">("volume");
	let creatingVolume = $state(false);
	let createError = $state<string | null>(null);
</script>

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div
      class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
    >
      <HardDrive class="size-4" />
    </div>
    <div>
      <h2 class="text-text text-sm font-semibold">Volumes</h2>
      <p class="text-text-muted text-xs">
        Mount a storage volume into the container. Takes effect on the next
        deploy.
      </p>
    </div>
  </div>

  {#if data.mounts.length > 0}
    <div class="divide-border border-border divide-y border-b">
      {#each data.mounts as mount (mount.id)}
        <div class="flex items-center gap-3 px-5 py-3">
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-medium">
              {mount.volumeName}
              {#if mount.readOnly}
                <span class="text-text-subtle text-xs font-normal"
                  >(read-only)</span
                >
              {/if}
            </p>
            <p class="text-text-muted truncate font-mono text-xs">
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
            <Button size="icon-sm" title="Remove" type="submit" variant="ghost">
              <X class="size-4" />
            </Button>
          </form>
        </div>
      {/each}
    </div>
  {/if}

  <div class="p-5">
    {#if data.volumes.length === 0}
      <p class="text-text-subtle text-xs">
        No storage volumes yet :
        <button
          class="text-accent underline"
          onclick={() => {
            newVolumeOpen = true;
          }}
          type="button"
        >
          create one
        </button>
        without leaving this page.
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
          <div class="mb-1.5 flex items-center justify-between">
            <label class="text-text block text-xs font-medium" for="volumeId">
              Volume
            </label>
            <button
              class="text-accent text-xs underline"
              onclick={() => {
                newVolumeOpen = true;
              }}
              type="button"
            >
              New volume
            </button>
          </div>
          <SelectRoot name="volumeId" type="single" bind:value={volumeId}>
            <SelectTrigger class="w-full" id="volumeId">
              {data.volumes.find((v) => v.id === volumeId)?.name ??
                "Select a volume"}
            </SelectTrigger>
            <SelectContent>
              {#each data.volumes as vol (vol.id)}
                <SelectItem label={vol.name} value={vol.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>
        <div class="flex-1">
          <label
            class="text-text mb-1.5 block text-xs font-medium"
            for="containerPath"
          >
            Mount path
          </label>
          <Input
            class="font-mono"
            id="containerPath"
            name="containerPath"
            placeholder="/data"
            required
            type="text"
          />
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
        <Button type="submit" variant="outline">
          <Plus class="size-3.5" />
          Mount
        </Button>
      </form>
    {/if}
  </div>
</section>

<Dialog.Root bind:open={newVolumeOpen}>
  <Dialog.Content>
    <Dialog.Header>
      <Dialog.Title>New volume</Dialog.Title>
      <Dialog.Description>
        A local storage source : mount it into this service right after, no
        need to leave the page.
      </Dialog.Description>
    </Dialog.Header>

    <form
      action="?/createVolume"
      class="space-y-5"
      method="POST"
      use:enhance={() => {
        creatingVolume = true;
        createError = null;
        return async ({ result }) => {
          creatingVolume = false;
          if (result.type === "failure") {
            createError =
              (result.data?.error as string | undefined) ??
              "Check the form for errors.";
            return;
          }
          if (result.type === "success") {
            const newId = result.data?.volumeId as string | undefined;
            newVolumeOpen = false;
            await invalidateAll();
            if (newId) {
              volumeId = newId;
            }
            toast.success("Volume created : select it above to mount it.");
          }
        };
      }}
    >
      {#if createError}
        <div
          class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
        >
          {createError}
        </div>
      {/if}

      <NewVolumeFields bind:kind={newVolumeKind} />

      <Dialog.Footer>
        <Button
          onclick={() => {
            newVolumeOpen = false;
          }}
          type="button"
          variant="outline"
        >
          Cancel
        </Button>
        <Button disabled={creatingVolume} type="submit">
          {#if creatingVolume}
            <Spinner />
            Creating…
          {:else}
            <Plus class="size-3.5" />
            Create volume
          {/if}
        </Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>
