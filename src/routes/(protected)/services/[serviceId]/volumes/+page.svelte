<script lang="ts">
	import { FolderOpen, HardDrive, Plus, X } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
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
	import { HOST_VOLUME_PREFIX } from "$lib/constants";
	import { getUnknownHostVolumes } from "$lib/remote/docker-infra.remote";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import MountBackup from "./mount-backup.svelte";

	let volumeId = $state("");

	const { data } = $props();

	const known = $derived(
		data.volumes
			.filter((vol) => vol.kind === "volume")
			.map((vol) => vol.source),
	);
	const unknownHostVolumes = $derived(getUnknownHostVolumes(known));
	const hostVolumes = $derived(unknownHostVolumes.current ?? []);

	onMount(() => title.set("Volumes"));

	let newVolumeOpen = $state(false);
	let newVolumeKind = $state<"bind" | "volume">("volume");
	let creatingVolume = $state(false);
	let createError = $state<string | null>(null);

	const selectedLabel = $derived.by(() => {
		if (volumeId.startsWith(HOST_VOLUME_PREFIX)) {
			return volumeId.slice(HOST_VOLUME_PREFIX.length);
		}
		return (
			data.volumes.find((v) => v.id === volumeId)?.name ?? "Select a volume"
		);
	});
</script>

<section class="panel rounded-md">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <HardDrive class="size-4" />
    </div>
    <div>
      <h2 class="eyebrow">Volumes</h2>
      <p class="text-text-muted text-xs">
        Mount a storage volume into the container. Takes effect on the next
        deploy.
      </p>
    </div>
  </div>

  {#if data.mounts.length > 0}
    <div class="divide-border border-border divide-y border-b">
      {#each data.mounts as mount (mount.id)}
        {@const vol = data.volumes.find((v) => v.id === mount.volumeId)}
        <div class="flex items-center gap-3 px-5 py-3">
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-medium">
              {mount.volumeName}
              {#if mount.readOnly}
                <span class="text-text-subtle text-xs font-normal"
                >(read-only)</span>
              {/if}
            </p>
            <p class="text-text-muted truncate text-xs">
              {mount.containerPath}
            </p>
          </div>
          <Button
            href={resolve("/(protected)/storage/[volumeId]/files", {
              volumeId: mount.volumeId,
            })}
            size="sm"
            variant="outline"
          >
            <FolderOpen class="size-4" />
            Browse
          </Button>
          {#if vol}
            <MountBackup destinations={data.destinations} volume={vol} />
          {/if}
          <form
            action="?/detachVolume"
            method="POST"
            use:enhance={enhanceToast({
              error: "Couldn't remove the mount.",
              loading: "Removing the mount",
              success: "Mount removed.",
            })}
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
    {#if data.volumes.length === 0 && hostVolumes.length === 0}
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
        use:enhance={enhanceToast({
          error: "Couldn't mount the volume.",
          loading: "Mounting the volume",
          success: "Volume mounted.",
        })}
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
              {selectedLabel}
            </SelectTrigger>
            <SelectContent>
              {#each data.volumes as vol (vol.id)}
                <SelectItem label={vol.name} value={vol.id} />
              {/each}
              {#if hostVolumes.length > 0}
                <div class="text-text-subtle px-2 py-1.5 text-[0.6875rem] font-medium">
                  On this machine
                </div>
                {#each hostVolumes as name (name)}
                  <SelectItem label={name} value="{HOST_VOLUME_PREFIX}{name}" />
                {/each}
              {/if}
            </SelectContent>
          </SelectRoot>
          {#if volumeId.startsWith(HOST_VOLUME_PREFIX)}
            <p class="text-text-subtle mt-1.5 text-xs">
              Already on this machine : mounting it adds it to Storage too.
            </p>
          {/if}
        </div>
        <div class="flex-1">
          <label
            class="text-text mb-1.5 block text-xs font-medium"
            for="containerPath"
          >
            Mount path
          </label>
          <Input
            class=""
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
        A local storage source, created and mounted into this service in one
        step.
      </Dialog.Description>
    </Dialog.Header>

    <form
      action="?/createVolume"
      class="space-y-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create the volume.",
        loading: "Creating the volume",
        onSuccess: () => {
          newVolumeOpen = false;
          return refreshAll();
        },
        success: "Volume created and mounted. Redeploy for it to take effect.",
      })}
    >
      {#if createError}
        <Alert>
          {createError}
        </Alert>
      {/if}

      <NewVolumeFields bind:kind={newVolumeKind} />

      <div>
        <label class="text-text mb-1.5 block text-sm font-medium" for="newContainerPath">
          Mount path in this container <span class="text-red-500">*</span>
        </label>
        <Input
          id="newContainerPath"
          name="containerPath"
          placeholder="/data"
          required
          type="text"
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          Where the volume shows up inside the container, e.g.
          <code>/mnt/drive</code> or <code>/config</code>.
        </p>
      </div>
      <CheckBox
        checked={false}
        helperText="Mount this volume without write access"
        id="newReadOnly"
        label="Read-only"
        name="readOnly"
      />

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
