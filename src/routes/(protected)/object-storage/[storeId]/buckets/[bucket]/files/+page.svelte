<script lang="ts">
	import {
		ChevronRight,
		Download,
		File,
		Folder,
		FolderPlus,
		Trash2,
		Upload,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { inputClass } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { formatBytes, timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set(`Object Storage · ${data.bucket}`));

	const filesHref = $derived(
		resolve("/(protected)/object-storage/[storeId]/buckets/[bucket]/files", {
			bucket: data.bucket,
			storeId: data.storeId,
		}),
	);
	const downloadHref = $derived(
		resolve(
			"/(protected)/object-storage/[storeId]/buckets/[bucket]/files/download",
			{ bucket: data.bucket, storeId: data.storeId },
		),
	);

	let folderName = $state("");
	let picked = $state(0);
	let uploading = $state(false);
	let confirmOpen = $state(false);
	let pendingKey = $state("");
	let pendingForm: HTMLFormElement | null = null;

	function folderHref(prefix: string): string {
		return prefix
			? `${filesHref}?${new URLSearchParams({ prefix })}`
			: filesHref;
	}

	function requestDelete(event: MouseEvent, key: string) {
		pendingForm = (event.currentTarget as HTMLElement).closest("form");
		pendingKey = key;
		confirmOpen = true;
	}
</script>

<div class="space-y-4">
  <div class="panel flex flex-wrap items-center gap-3 rounded-md px-4 py-3">
    <nav aria-label="Folder" class="flex min-w-0 flex-1 flex-wrap items-center gap-1 font-mono text-sm">
      <a class="text-text-muted hover:text-text" href={folderHref("")}>{data.bucket}</a>
      {#each data.trail as crumb (crumb.prefix)}
        <ChevronRight class="text-text-subtle size-3.5" />
        <a class="text-text-muted hover:text-text" href={folderHref(crumb.prefix)}>{crumb.name}</a>
      {/each}
    </nav>
    <form
      class="flex items-center gap-2"
      action="?/newFolder"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create the folder.",
        loading: "Creating the folder",
        onSuccess: () => {
          folderName = "";
        },
        success: "Folder created.",
      })}
    >
      <input name="prefix" type="hidden" value={data.prefix} />
      <input
        class="{inputClass} h-8 w-40"
        aria-label="New folder name"
        autocomplete="off"
        name="name"
        placeholder="New folder"
        bind:value={folderName}
      />
      <Button disabled={!folderName} size="sm" type="submit" variant="outline">
        <FolderPlus class="size-4" />
        Create
      </Button>
    </form>
    <form
      class="flex items-center gap-2"
      action="?/upload"
      enctype="multipart/form-data"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't upload.",
        loading: "Uploading",
        onSettled: () => {
          uploading = false;
        },
        onStart: () => {
          uploading = true;
        },
        onSuccess: () => {
          picked = 0;
        },
        reset: true,
        success: (result) =>
          `Uploaded ${String(result?.uploaded ?? "")} file(s).`,
      })}
    >
      <input name="prefix" type="hidden" value={data.prefix} />
      <input
        class="text-text-muted file:bg-surface-2 file:text-text max-w-56 text-xs file:mr-2 file:rounded-md file:border-0 file:px-2 file:py-1"
        aria-label="Files to upload"
        multiple
        name="files"
        onchange={(event) => {
          picked = event.currentTarget.files?.length ?? 0;
        }}
        type="file"
      />
      <Button disabled={picked === 0 || uploading} size="sm" type="submit">
        <Upload class="size-4" />
        Upload
      </Button>
    </form>
  </div>

  {#if data.listing.folders.length === 0 && data.listing.objects.length === 0}
    <EmptyState
      icon={Folder}
      subtitle="Upload files or create a folder here."
      title={data.prefix ? "This folder is empty" : "This bucket is empty"}
    />
  {:else}
    <div class="panel overflow-x-auto rounded-md">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
            <th class="px-4 py-3 font-medium">Name</th>
            <th class="hidden px-4 py-3 font-medium md:table-cell">Size</th>
            <th class="hidden px-4 py-3 font-medium md:table-cell">Modified</th>
            <th class="px-4 py-3"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.listing.folders as folder (folder)}
            <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
              <td class="px-4 py-3" colspan="4">
                <a
                  class="text-text group-hover:text-accent inline-flex items-center gap-2 font-mono after:absolute after:inset-0"
                  href={folderHref(folder)}
                >
                  <Folder class="text-accent size-4" />
                  {folder.slice(data.prefix.length)}
                </a>
              </td>
            </tr>
          {/each}
          {#each data.listing.objects as object (object.key)}
            <tr class="border-border/60 hover:bg-surface-2 border-b last:border-0">
              <td class="px-4 py-3">
                <span class="text-text inline-flex items-center gap-2 font-mono break-all">
                  <File class="text-text-subtle size-4 shrink-0" />
                  {object.key.slice(data.prefix.length)}
                </span>
              </td>
              <td class="text-text-muted hidden px-4 py-3 tabular-nums md:table-cell">{formatBytes(object.size)}</td>
              <td class="text-text-muted hidden px-4 py-3 md:table-cell">
                {object.lastModified ? timeAgo(object.lastModified) : "—"}
              </td>
              <td class="px-4 py-3">
                <span class="flex justify-end gap-1">
                  <Button
                    aria-label="Download {object.key}"
                    href="{downloadHref}?{new URLSearchParams({ key: object.key })}"
                    size="icon-sm"
                    variant="ghost"
                  >
                    <Download class="size-4" />
                  </Button>
                  <form
                    action="?/delete"
                    method="POST"
                    use:enhance={enhanceToast({
                      error: "Couldn't delete the file.",
                      loading: "Deleting the file",
                      success: "File deleted.",
                    })}
                  >
                    <input name="key" type="hidden" value={object.key} />
                    <Button
                      class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                      aria-label="Delete {object.key}"
                      onclick={(event: MouseEvent) => requestDelete(event, object.key)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2 class="size-4" />
                    </Button>
                  </form>
                </span>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  {#if data.listing.nextToken}
    <div class="flex justify-end gap-2">
      <Button href={folderHref(data.prefix)} size="sm" variant="outline">First page</Button>
      <Button
        href="{filesHref}?{new URLSearchParams({ prefix: data.prefix, token: data.listing.nextToken })}"
        size="sm"
        variant="outline"
      >
        Next page
      </Button>
    </div>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Delete"
  description={`Delete ${pendingKey}? It's removed from the bucket for good.`}
  onConfirm={() => pendingForm?.requestSubmit()}
  title="Delete this file?"
/>
