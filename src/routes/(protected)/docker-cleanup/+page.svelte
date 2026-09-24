<script lang="ts">
	import {
		Boxes,
		Eraser,
		HardDrive,
		Layers,
		Loader2,
		Network as NetworkIcon,
		ShieldCheck,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import AsyncBlock from "$lib/components/async-block.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		getCleanupPreview,
		getMirrorUsage,
		getOrphanStackNetworks,
	} from "$lib/remote/docker-infra.remote";
	import { title } from "$lib/store/title";
	import { type EnhanceToastOptions, enhanceToast } from "$lib/toast";
	import {
		type CleanupAction,
		confirmCopy,
		describeResult,
		formatBytes,
		sumSize,
	} from "./cleanup";
	import CleanupItemList from "./cleanup-item-list.svelte";
	import CleanupPanel from "./cleanup-panel.svelte";

	const { form } = $props();

	const cleanup = getCleanupPreview();
	const orphans = getOrphanStackNetworks();
	const mirror = getMirrorUsage();

	onMount(() => title.set("Docker Cleanup"));

	let pendingAction = $state<CleanupAction | null>(null);
	let confirmAction = $state<CleanupAction | null>(null);
	let confirmDialogOpen = $state(false);
	let confirmForm: HTMLFormElement | null = null;
	let includeTagged = $state(false);

	function requestConfirm(action: CleanupAction, e: MouseEvent) {
		confirmForm = (e.currentTarget as HTMLElement).closest("form");
		confirmAction = action;
		confirmDialogOpen = true;
	}

	function confirmPending() {
		if (!confirmAction) {
			return;
		}
		pendingAction = confirmAction;
		confirmForm?.requestSubmit();
	}

	function pruneToast(
		action: CleanupAction,
		extra: Partial<EnhanceToastOptions> = {},
	) {
		return enhanceToast({
			error: "Docker cleanup action failed.",
			loading: "Running cleanup",
			onSettled: () => {
				pendingAction = null;
			},
			onStart: () => {
				pendingAction = action;
			},
			success: (data) =>
				describeResult((data as { result?: unknown } | undefined)?.result),
			...extra,
		});
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-6">
    <h1 class="text-text text-lg font-semibold tracking-tight">Docker Cleanup</h1>
    <p class="text-text-muted mt-1 text-sm">
      Reclaims disk space from unused Docker resources on this host. These
      actions apply to the whole host, not just what Homerun manages.
    </p>
  </div>

  <AsyncBlock errorTitle="Couldn't read the Docker daemon's disk usage." query={cleanup}>
    {#snippet pending()}
      <div class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
        {#each [0, 1, 2, 3, 4] as tile (tile)}
          <Skeleton class="h-23 rounded-md" />
        {/each}
      </div>
      {#each [0, 1, 2] as section (section)}
        <Skeleton class="mb-6 h-40 rounded-md" />
      {/each}
    {/snippet}
    {#snippet children(preview)}
    {@const tiles = [
      { label: "Images", sub: `${formatBytes(sumSize(preview.images.items))} reclaimable`, value: preview.images.totalCount },
      { label: "Containers", sub: `${preview.containers.items.length} stopped`, value: preview.containers.totalCount },
      { label: "Networks", sub: `${preview.networks.items.length} unused`, value: preview.networks.totalCount },
      { label: "Volumes", sub: `${preview.volumes.items.length} unused`, value: preview.volumes.totalCount },
      { label: "Build cache", sub: `${preview.buildCache.items.length} unused record(s)`, value: formatBytes(preview.buildCache.totalSizeBytes ?? 0) },
    ]}
    <div class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
      {#each tiles as tile (tile.label)}
        <div class="panel rounded-md p-4">
          <p class="eyebrow">{tile.label}</p>
          <p class="tabular-nums text-text mt-1 text-xl font-semibold">
            {tile.value}
          </p>
          <p class="text-text-subtle mt-0.5 text-xs">{tile.sub}</p>
        </div>
      {/each}
    </div>

    <section class="panel mb-6 rounded-md">
      <PanelHeader
        description="Stopped containers, dangling images, unused networks, and build cache. Same set as `docker system prune`."
        icon={Eraser}
        title="Quick cleanup"
      >
        {#snippet trailing()}
          <form action="?/pruneSystem" method="POST" use:enhance={pruneToast("pruneSystem")}>
            <Button
              disabled={pendingAction !== null}
              onclick={(e) => requestConfirm("pruneSystem", e)}
              type="button"
            >
              {#if pendingAction === "pruneSystem"}
                <Loader2 class="size-3.5 animate-spin" />
              {:else}
                <Eraser class="size-3.5" />
              {/if}
              Clean up now
            </Button>
          </form>
        {/snippet}
      </PanelHeader>
    </section>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <CleanupPanel
        action="pruneContainers"
        buttonLabel="Prune stopped"
        icon={Boxes}
        items={preview.containers.items}
        onConfirm={(e) => requestConfirm("pruneContainers", e)}
        {pendingAction}
        submit={pruneToast("pruneContainers")}
        title="Containers"
      />

      <CleanupPanel
        action="pruneImages"
        buttonLabel="Prune images"
        dimTagged={!includeTagged}
        icon={Layers}
        items={preview.images.items}
        onConfirm={(e) => requestConfirm("pruneImages", e)}
        {pendingAction}
        submit={pruneToast("pruneImages")}
        title="Images"
      >
        {#snippet extraFields()}
          <CheckBox
            bind:checked={includeTagged}
            helperText="Also remove unused images that still have a tag, not just dangling ones."
            id="includeTagged"
            label="Include tagged, unused images"
            name="all"
          />
        {/snippet}
      </CleanupPanel>

      <section class="panel rounded-md">
        <PanelHeader icon={NetworkIcon} title="Networks">
          {#snippet trailing()}
            <div class="flex items-center gap-2">
              <form
                action="?/reclaimStackNetworks"
                method="POST"
                use:enhance={pruneToast("reclaimStackNetworks", {
                  loading: "Reclaiming orphaned stack networks",
                  onComplete: () => orphans.refresh(),
                })}
              >
                <Button
                  disabled={pendingAction !== null}
                  onclick={(e) => requestConfirm("reclaimStackNetworks", e)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {#if pendingAction === "reclaimStackNetworks"}
                    <Loader2 class="size-3.5 animate-spin" />
                  {/if}
                  Reclaim orphaned
                </Button>
              </form>
              <form action="?/pruneNetworks" method="POST" use:enhance={pruneToast("pruneNetworks")}>
                <Button
                  disabled={pendingAction !== null}
                  onclick={(e) => requestConfirm("pruneNetworks", e)}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {#if pendingAction === "pruneNetworks"}
                    <Loader2 class="size-3.5 animate-spin" />
                  {/if}
                  Prune unused
                </Button>
              </form>
            </div>
          {/snippet}
        </PanelHeader>
        <div class="space-y-3 p-5">
          {#if orphans.current && orphans.current.length > 0}
            <div class="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
              <p class="text-xs font-medium text-amber-600 dark:text-amber-400">
                {orphans.current.length} stack network(s) outlived their
                stack
              </p>
              <ul class="mt-2 space-y-1">
                {#each orphans.current as orphan (orphan.id)}
                  <li class="text-text-muted flex justify-between gap-3 font-mono text-xs">
                    <span class="truncate">{orphan.name}</span>
                    <span class="text-text-subtle shrink-0">
                      {orphan.containersAttached > 0
                        ? `${orphan.containersAttached} attached, kept`
                        : "unused"}
                    </span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          <CleanupItemList items={preview.networks.items} />
        </div>
      </section>

      <CleanupPanel
        action="pruneBuildCache"
        buttonLabel="Prune cache"
        icon={HardDrive}
        items={preview.buildCache.items}
        onConfirm={(e) => requestConfirm("pruneBuildCache", e)}
        {pendingAction}
        submit={pruneToast("pruneBuildCache")}
        title="Build cache"
      />
    </div>

  <section class="panel mt-6 rounded-md">
    <PanelHeader icon={ShieldCheck} title="Image mirror">
      {#snippet description()}
        The <code>homerun-mirror</code> registry images are scanned in.
        Cleaned up daily at 04:00 : anything no service runs goes, each
        service's current image and last two scanned versions stay.
      {/snippet}
      {#snippet trailing()}
        <form
          action="?/pruneMirror"
          method="POST"
          use:enhance={pruneToast("pruneMirror", {
            error: "Mirror cleanup failed.",
            loading: "Cleaning up the image mirror",
            onComplete: () => mirror.refresh(),
          })}
        >
          <Button
            disabled={pendingAction !== null || !mirror.current?.running}
            onclick={(e) => requestConfirm("pruneMirror", e)}
            size="sm"
            type="button"
            variant="outline"
          >
            {#if pendingAction === "pruneMirror"}
              <Loader2 class="size-3.5 animate-spin" />
            {/if}
            Clean up mirror
          </Button>
        </form>
      {/snippet}
    </PanelHeader>
    <div class="p-5">
      {#if mirror.error}
        <p class="text-text-subtle text-xs">Couldn't read the mirror's size.</p>
      {:else if !mirror.current}
        <Skeleton class="h-5 w-40 rounded-md" />
      {:else if !mirror.current.running}
        <p class="text-text-subtle text-xs">
          The mirror isn't running. It's created on the first deploy with
          image scanning on.
        </p>
      {:else}
        <p class="text-text text-sm">
          <span class="tabular-nums font-semibold">
            {mirror.current.sizeBytes === null
              ? "Unknown size"
              : formatBytes(mirror.current.sizeBytes)}
          </span>
          <span class="text-text-subtle text-xs">
            {mirror.current.collecting ? "cleanup in progress" : "on disk"}
          </span>
        </p>
      {/if}
    </div>
  </section>

  <section class="bg-surface mt-6 rounded-md border border-red-200 dark:border-red-900/40">
    <div class="flex items-center gap-3 border-b border-red-100 px-5 py-4 dark:border-red-900/30">
      <div class="flex size-8 items-center justify-center rounded-lg bg-red-500/10 text-red-600">
        <TriangleAlert class="size-4" />
      </div>
      <div>
        <h2 class="text-sm font-semibold text-red-600 dark:text-red-400">
          Volumes
        </h2>
        <p class="text-text-muted text-xs">
          Can permanently delete data. Not included in Quick cleanup.
          Volumes mounted into a Homerun service are never listed or pruned.
        </p>
      </div>
      <form action="?/pruneVolumes" class="ml-auto" method="POST" use:enhance={pruneToast("pruneVolumes")}>
        <Button
          disabled={pendingAction !== null}
          onclick={(e) => requestConfirm("pruneVolumes", e)}
          type="button"
          variant="destructive"
        >
          {#if pendingAction === "pruneVolumes"}
            <Loader2 class="size-3.5 animate-spin" />
          {/if}
          Prune unused volumes
        </Button>
      </form>
    </div>
      <div class="p-5">
        <CleanupItemList items={preview.volumes.items} />
      </div>
    </section>
    {/snippet}
  </AsyncBlock>
</div>

<ConfirmDialog
  bind:open={confirmDialogOpen}
  confirmLabel={confirmAction ? confirmCopy[confirmAction].confirmLabel : "Confirm"}
  description={confirmAction ? confirmCopy[confirmAction].description : undefined}
  onConfirm={confirmPending}
  title={confirmAction ? confirmCopy[confirmAction].title : "Are you sure?"}
/>
