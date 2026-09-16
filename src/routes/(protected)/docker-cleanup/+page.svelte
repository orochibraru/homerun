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
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		getCleanupPreview,
		getMirrorUsage,
		getOrphanStackNetworks,
	} from "$lib/remote/docker-infra.remote";
	import type { CleanupItem } from "$lib/services/docker.service";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	const cleanup = getCleanupPreview();
	const orphans = getOrphanStackNetworks();
	const mirror = getMirrorUsage();

	onMount(() => title.set("Docker Cleanup"));

	type CleanupAction =
		| "pruneBuildCache"
		| "pruneContainers"
		| "pruneImages"
		| "pruneMirror"
		| "pruneNetworks"
		| "pruneSystem"
		| "pruneVolumes"
		| "reclaimStackNetworks";

	const confirmCopy: Record<
		CleanupAction,
		{ confirmLabel: string; description: string; title: string }
	> = {
		pruneBuildCache: {
			confirmLabel: "Prune",
			description:
				"Removes the Docker builder's cache. The next git-based build starts from scratch, or from a configured build-cache registry if one's set.",
			title: "Prune build cache?",
		},
		pruneContainers: {
			confirmLabel: "Prune",
			description:
				"Permanently removes every stopped container on this host, not just ones this app created. Their logs and any un-mounted data inside them are gone.",
			title: "Prune stopped containers?",
		},
		pruneImages: {
			confirmLabel: "Prune",
			description:
				"Removes dangling images by default. Check “Include tagged, unused images” below to remove any image not used by a container, tagged or not.",
			title: "Prune images?",
		},
		pruneMirror: {
			confirmLabel: "Clean up",
			description:
				"Deletes every image in the homerun-mirror registry that no service runs, keeping each service's current image and its last two scanned versions, then reclaims the space. Deploys wait until it's done.",
			title: "Clean up the image mirror?",
		},
		pruneNetworks: {
			confirmLabel: "Prune",
			description:
				"Removes every Docker network on this host not currently used by a container.",
			title: "Prune unused networks?",
		},
		reclaimStackNetworks: {
			confirmLabel: "Reclaim",
			description:
				"Removes the per-stack networks whose stack no longer exists. One with containers still attached is left alone. Nothing else on this host is touched.",
			title: "Reclaim orphaned stack networks?",
		},
		pruneSystem: {
			confirmLabel: "Clean up",
			description:
				"Runs stopped-container, dangling-image, unused-network, and build-cache pruning together, same as docker system prune. Doesn't touch volumes.",
			title: "Clean up this Docker host?",
		},
		pruneVolumes: {
			confirmLabel: "Prune",
			description:
				"Permanently deletes every unused Docker-managed volume on this host, including any Storage volume whose data isn't currently mounted into a service. This can't be undone.",
			title: "Prune unused volumes?",
		},
	};

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

	function formatBytes(bytes: number): string {
		const units = ["B", "KB", "MB", "GB", "TB"];
		let value = bytes;
		let i = 0;
		while (value >= 1024 && i < units.length - 1) {
			value /= 1024;
			i += 1;
		}
		return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
	}

	function sumSize(items: CleanupItem[]): number {
		return items.reduce((sum, item) => sum + (item.sizeBytes ?? 0), 0);
	}

	function isSystemResult(
		result: unknown,
	): result is Record<
		string,
		{ itemsDeleted: number; spaceReclaimedBytes: number }
	> {
		return !!result && typeof result === "object" && "containers" in result;
	}

	function describeResult(result: unknown): string {
		if (isSystemResult(result)) {
			const parts = Object.values(result);
			const items = parts.reduce((sum, p) => sum + p.itemsDeleted, 0);
			const bytes = parts.reduce((sum, p) => sum + p.spaceReclaimedBytes, 0);
			return `Cleaned up ${items} item(s), reclaimed ${formatBytes(bytes)}.`;
		}
		const r = result as { itemsDeleted: number; spaceReclaimedBytes: number };
		return `Removed ${r.itemsDeleted} item(s), reclaimed ${formatBytes(r.spaceReclaimedBytes)}.`;
	}
</script>

{#snippet itemList(items: CleanupItem[], dimUnlessTagged = false)}
  {#if items.length === 0}
    <p class="text-text-subtle px-1 py-2 text-xs">Nothing to clean up.</p>
  {:else}
    <ul class="max-h-48 space-y-1 overflow-y-auto">
      {#each items as item (item.id)}
        <li
          class="bg-surface-2 flex items-center justify-between gap-3 rounded-lg px-3 py-1.5 text-xs {dimUnlessTagged && item.dangling === false && !includeTagged ? 'opacity-40' : ''}"
        >
          <div class="min-w-0">
            <p class="text-text truncate">{item.label}</p>
            {#if item.detail}
              <p class="text-text-subtle truncate">{item.detail}</p>
            {/if}
          </div>
          {#if item.sizeBytes != null}
            <span class="text-text-muted shrink-0">
              {formatBytes(item.sizeBytes)}
            </span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/snippet}

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
          <Skeleton class="h-[5.75rem] rounded-md" />
        {/each}
      </div>
      {#each [0, 1, 2] as section (section)}
        <Skeleton class="mb-6 h-40 rounded-md" />
      {/each}
    {/snippet}
    {#snippet children(preview)}
    <div class="mb-6 grid grid-cols-2 gap-4 md:grid-cols-5">
      <div class="panel rounded-md p-4">
        <p class="eyebrow">Images</p>
        <p class="tabular-nums text-text mt-1 text-xl font-semibold">
          {preview.images.totalCount}
        </p>
        <p class="text-text-subtle mt-0.5 text-xs">
          {formatBytes(sumSize(preview.images.items))} reclaimable
        </p>
      </div>
      <div class="panel rounded-md p-4">
        <p class="eyebrow">Containers</p>
        <p class="tabular-nums text-text mt-1 text-xl font-semibold">
          {preview.containers.totalCount}
        </p>
        <p class="text-text-subtle mt-0.5 text-xs">
          {preview.containers.items.length} stopped
        </p>
      </div>
      <div class="panel rounded-md p-4">
        <p class="eyebrow">Networks</p>
        <p class="tabular-nums text-text mt-1 text-xl font-semibold">
          {preview.networks.totalCount}
        </p>
        <p class="text-text-subtle mt-0.5 text-xs">
          {preview.networks.items.length} unused
        </p>
      </div>
      <div class="panel rounded-md p-4">
        <p class="eyebrow">Volumes</p>
        <p class="tabular-nums text-text mt-1 text-xl font-semibold">
          {preview.volumes.totalCount}
        </p>
        <p class="text-text-subtle mt-0.5 text-xs">
          {preview.volumes.items.length} unused
        </p>
      </div>
      <div class="panel rounded-md p-4">
        <p class="eyebrow">Build cache</p>
        <p class="tabular-nums text-text mt-1 text-xl font-semibold">
          {formatBytes(preview.buildCache.totalSizeBytes ?? 0)}
        </p>
        <p class="text-text-subtle mt-0.5 text-xs">
          {preview.buildCache.items.length} unused record(s)
        </p>
      </div>
    </div>

    <section class="panel mb-6 rounded-md">
      <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
        <div class="flex items-center gap-2">
          <Eraser class="text-text-muted size-4" />
          <div>
            <h2 class="eyebrow">Quick cleanup</h2>
            <p class="text-text-muted text-xs">
              Stopped containers, dangling images, unused networks, and build
              cache. Same set as `docker system prune`.
            </p>
          </div>
        </div>
        <form action="?/pruneSystem" method="POST"
        use:enhance={enhanceToast({
          error: "Docker cleanup action failed.",
          loading: "Running cleanup",
          onSettled: () => {
            pendingAction = null;
          },
          onStart: () => {
            pendingAction = "pruneSystem";
          },
          success: (data) =>
            describeResult((data as { result?: unknown } | undefined)?.result),
        })}
        >
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
      </div>
    </section>

    <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
      <section class="panel rounded-md">
        <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
          <div class="flex items-center gap-2">
            <Boxes class="text-text-muted size-4" />
            <h2 class="eyebrow">Containers</h2>
          </div>
          <form action="?/pruneContainers" method="POST"
        use:enhance={enhanceToast({
          error: "Docker cleanup action failed.",
          loading: "Running cleanup",
          onSettled: () => {
            pendingAction = null;
          },
          onStart: () => {
            pendingAction = "pruneContainers";
          },
          success: (data) =>
            describeResult((data as { result?: unknown } | undefined)?.result),
        })}
        >
            <Button
              disabled={pendingAction !== null}
              onclick={(e) => requestConfirm("pruneContainers", e)}
              size="sm"
              type="button"
              variant="outline"
            >
              {#if pendingAction === "pruneContainers"}
                <Loader2 class="size-3.5 animate-spin" />
              {/if}
              Prune stopped
            </Button>
          </form>
        </div>
        <div class="p-5">
          {@render itemList(preview.containers.items)}
        </div>
      </section>

      <section class="panel rounded-md">
        <form action="?/pruneImages" method="POST"
        use:enhance={enhanceToast({
          error: "Docker cleanup action failed.",
          loading: "Running cleanup",
          onSettled: () => {
            pendingAction = null;
          },
          onStart: () => {
            pendingAction = "pruneImages";
          },
          success: (data) =>
            describeResult((data as { result?: unknown } | undefined)?.result),
        })}
        >
          <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
            <div class="flex items-center gap-2">
              <Layers class="text-text-muted size-4" />
              <h2 class="eyebrow">Images</h2>
            </div>
            <Button
              disabled={pendingAction !== null}
              onclick={(e) => requestConfirm("pruneImages", e)}
              size="sm"
              type="button"
              variant="outline"
            >
              {#if pendingAction === "pruneImages"}
                <Loader2 class="size-3.5 animate-spin" />
              {/if}
              Prune images
            </Button>
          </div>
          <div class="space-y-3 p-5">
            <CheckBox
              bind:checked={includeTagged}
              helperText="Also remove unused images that still have a tag, not just dangling ones."
              id="includeTagged"
              label="Include tagged, unused images"
              name="all"
            />
            {@render itemList(preview.images.items, true)}
          </div>
        </form>
      </section>

      <section class="panel rounded-md">
        <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
          <div class="flex items-center gap-2">
            <NetworkIcon class="text-text-muted size-4" />
            <h2 class="eyebrow">Networks</h2>
          </div>
          <div class="flex items-center gap-2">
            <form
              action="?/reclaimStackNetworks"
              method="POST"
              use:enhance={enhanceToast({
                error: "Docker cleanup action failed.",
                loading: "Reclaiming orphaned stack networks",
                onComplete: () => orphans.refresh(),
                onSettled: () => {
                  pendingAction = null;
                },
                onStart: () => {
                  pendingAction = "reclaimStackNetworks";
                },
                success: (data) =>
                  describeResult(
                    (data as { result?: unknown } | undefined)?.result,
                  ),
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
            <form action="?/pruneNetworks" method="POST"
          use:enhance={enhanceToast({
            error: "Docker cleanup action failed.",
            loading: "Running cleanup",
            onSettled: () => {
              pendingAction = null;
            },
            onStart: () => {
              pendingAction = "pruneNetworks";
            },
            success: (data) =>
              describeResult((data as { result?: unknown } | undefined)?.result),
          })}
          >
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
        </div>
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
          {@render itemList(preview.networks.items)}
        </div>
      </section>

      <section class="panel rounded-md">
        <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
          <div class="flex items-center gap-2">
            <HardDrive class="text-text-muted size-4" />
            <h2 class="eyebrow">Build cache</h2>
          </div>
          <form action="?/pruneBuildCache" method="POST"
        use:enhance={enhanceToast({
          error: "Docker cleanup action failed.",
          loading: "Running cleanup",
          onSettled: () => {
            pendingAction = null;
          },
          onStart: () => {
            pendingAction = "pruneBuildCache";
          },
          success: (data) =>
            describeResult((data as { result?: unknown } | undefined)?.result),
        })}
        >
            <Button
              disabled={pendingAction !== null}
              onclick={(e) => requestConfirm("pruneBuildCache", e)}
              size="sm"
              type="button"
              variant="outline"
            >
              {#if pendingAction === "pruneBuildCache"}
                <Loader2 class="size-3.5 animate-spin" />
              {/if}
              Prune cache
            </Button>
          </form>
        </div>
        <div class="p-5">
          {@render itemList(preview.buildCache.items)}
        </div>
      </section>
    </div>

  <section class="panel mt-6 rounded-md">
    <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
      <div class="flex items-center gap-2">
        <ShieldCheck class="text-text-muted size-4" />
        <div>
          <h2 class="eyebrow">Image mirror</h2>
          <p class="text-text-muted text-xs">
            The <code>homerun-mirror</code> registry images are scanned in.
            Cleaned up daily at 04:00 : anything no service runs goes, each
            service's current image and last two scanned versions stay.
          </p>
        </div>
      </div>
      <form action="?/pruneMirror" method="POST"
      use:enhance={enhanceToast({
        error: "Mirror cleanup failed.",
        loading: "Cleaning up the image mirror",
        onComplete: () => mirror.refresh(),
        onSettled: () => {
          pendingAction = null;
        },
        onStart: () => {
          pendingAction = "pruneMirror";
        },
        success: (data) =>
          describeResult((data as { result?: unknown } | undefined)?.result),
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
    </div>
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
        </p>
      </div>
      <form action="?/pruneVolumes" class="ml-auto" method="POST"
      use:enhance={enhanceToast({
        error: "Docker cleanup action failed.",
        loading: "Running cleanup",
        onSettled: () => {
          pendingAction = null;
        },
        onStart: () => {
          pendingAction = "pruneVolumes";
        },
        success: (data) =>
          describeResult((data as { result?: unknown } | undefined)?.result),
      })}
      >
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
        {@render itemList(preview.volumes.items)}
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
