<script lang="ts">
	import {
		ArrowLeft,
		Check,
		ChevronRight,
		File,
		FilePlus,
		Folder,
		FolderPlus,
		KeyRound,
		Link2,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import Alert from "$lib/components/alert.svelte";
	import CodeEditor from "$lib/components/code-editor.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { inputClass, labelClass } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";
	import * as Dialog from "$lib/components/ui/dialog/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { formatBytes, timeAgo } from "$lib/formatting";
	import { languageFor } from "$lib/highlight";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { parentPath } from "$lib/volume-files";

	const { data } = $props();
	const vol = $derived(data.volume);

	onMount(() => title.set(`${vol.name} · Files`));

	const dirHref = (path: string) =>
		path ? `?path=${encodeURIComponent(path)}` : "?";
	const fileHref = (path: string) => `?file=${encodeURIComponent(path)}`;

	const crumbs = $derived.by(() => {
		const segments = data.path ? data.path.split("/") : [];
		return segments.map((name, index) => ({
			name,
			path: segments.slice(0, index + 1).join("/"),
		}));
	});

	let content = $derived(
		data.file && data.file.editable ? data.file.content : "",
	);
	let saving = $state(false);

	let createOpen = $state(false);
	let createKind = $state<"directory" | "file">("file");
	let createName = $state("");
	let chmodOpen = $state(false);
	let chmodMode = $state("");
	let deleteOpen = $state(false);
	let target = $state({ kind: "file", name: "", path: "" });
	let deleteForm = $state<HTMLFormElement | null>(null);

	function openCreate(kind: "directory" | "file") {
		createKind = kind;
		createName = "";
		createOpen = true;
	}

	function openChmod(entry: {
		kind: string;
		mode: string;
		name: string;
		path: string;
	}) {
		target = entry;
		chmodMode = entry.mode;
		chmodOpen = true;
	}

	function openDelete(entry: { kind: string; name: string; path: string }) {
		target = entry;
		deleteOpen = true;
	}
</script>

{#if data.error}
  <Alert class="mb-4" title="Couldn't open that">
    {data.error}
    {#snippet actions()}
      <Button href={dirHref(data.path)} size="sm" variant="outline">Back</Button>
    {/snippet}
  </Alert>
{/if}

{#if data.file}
  {@const file = data.file}
  <div class="mb-3 flex flex-wrap items-center gap-3">
    <Button
      href={dirHref(parentPath(file.path))}
      size="sm"
      variant="ghost"
    >
      <ArrowLeft class="size-4" />
      Back
    </Button>
    <span class="text-text min-w-0 font-mono text-sm break-all">/{file.path}</span>
    <span class="text-text-subtle text-xs">{formatBytes(file.size)}</span>
  </div>
  {#if file.editable}
    <form
      action="?/save"
      class="space-y-3"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the file.",
        loading: "Saving the file",
        onSettled: () => {
          saving = false;
        },
        onStart: () => {
          saving = true;
        },
        success: "Saved. Restart the services using this volume to pick it up.",
      })}
    >
      <input name="path" type="hidden" value={file.path}>
      <CodeEditor
        aria-label="File content"
        language={languageFor(file.path)}
        name="content"
        bind:value={content}
      />
      <Button disabled={saving} type="submit">
        {#if saving}
          <Spinner />
        {:else}
          <Check class="size-4" />
        {/if}
        Save
      </Button>
    </form>
  {:else}
    <p class="text-text-muted text-sm">
      This isn't a text file, so it can't be edited here.
    </p>
  {/if}
{:else if data.listing}
  <div class="mb-3 flex flex-wrap items-center justify-between gap-3">
    <nav aria-label="Folder" class="flex flex-wrap items-center gap-1 text-sm">
      <a class="text-text-muted hover:text-text" href={dirHref("")}>{vol.name}</a>
      {#each crumbs as crumb (crumb.path)}
        <ChevronRight class="text-text-subtle size-3.5" />
        <a class="text-text-muted hover:text-text" href={dirHref(crumb.path)}>
          {crumb.name}
        </a>
      {/each}
    </nav>
    {#if !data.listing.isFile}
      <div class="flex gap-2">
        <Button onclick={() => openCreate("file")} size="sm" variant="outline">
          <FilePlus class="size-4" />
          New file
        </Button>
        <Button onclick={() => openCreate("directory")} size="sm" variant="outline">
          <FolderPlus class="size-4" />
          New folder
        </Button>
      </div>
    {/if}
  </div>
  {#if data.listing.entries.length === 0}
    <div class="border-border/70 rounded-md border border-dashed py-12 text-center">
      <p class="text-text-muted text-sm">This folder is empty.</p>
    </div>
  {:else}
    <div class="panel divide-border divide-y overflow-hidden rounded-xl">
      {#each data.listing.entries as entry (entry.path)}
        {@const Icon = entry.kind === "directory" ? Folder : entry.kind === "link" ? Link2 : File}
        <ContextMenu.Root>
          <ContextMenu.Trigger class="block">
            <a
              class="hover:bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 px-4 py-2.5 transition-colors sm:flex-nowrap"
              href={entry.kind === "directory" ? dirHref(entry.path) : fileHref(entry.path)}
            >
              <Icon class="text-accent size-4 shrink-0" />
              <span class="text-text min-w-0 flex-1 truncate font-mono text-sm">
                {entry.name}
              </span>
              <span class="flex w-full shrink-0 items-center gap-3 pl-7 sm:w-auto sm:pl-0">
                {#if entry.kind !== "directory"}
                  <span class="text-text-subtle shrink-0 text-xs tabular-nums">
                    {formatBytes(entry.size)}
                  </span>
                {/if}
                <span class="text-text-subtle shrink-0 text-xs sm:w-24 sm:text-right">
                  {timeAgo(entry.modifiedAt)}
                </span>
              </span>
            </a>
          </ContextMenu.Trigger>
          <ContextMenu.Content class="w-52">
            <ContextMenu.Item onSelect={() => openChmod(entry)}>
              <KeyRound class="size-4" />
              Change permissions
            </ContextMenu.Item>
            {#if entry.path}
              <ContextMenu.Separator />
              <ContextMenu.Item onSelect={() => openDelete(entry)} variant="destructive">
                <Trash2 class="size-4" />
                Delete
              </ContextMenu.Item>
            {/if}
          </ContextMenu.Content>
        </ContextMenu.Root>
      {/each}
    </div>
  {/if}
{/if}

<Dialog.Root bind:open={createOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>{createKind === "directory" ? "New folder" : "New file"}</Dialog.Title>
      <Dialog.Description>In /{data.path}</Dialog.Description>
    </Dialog.Header>
    <form
      action="?/create"
      class="space-y-4"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create it.",
        loading: createKind === "directory" ? "Creating the folder" : "Creating the file",
        onSuccess: async (result) => {
          createOpen = false;
          if (result?.kind === "file" && typeof result.path === "string") {
            await goto(fileHref(result.path));
          }
        },
        success: (result) => (result?.kind === "directory" ? "Folder created." : "File created."),
      })}
    >
      <input name="dir" type="hidden" value={data.path}>
      <input name="kind" type="hidden" value={createKind}>
      <div>
        <label class={labelClass} for="entry-name">Name</label>
        <input
          id="entry-name"
          class={inputClass}
          autocomplete="off"
          name="name"
          pattern="[^/]+"
          placeholder={createKind === "directory" ? "conf.d" : "config.yaml"}
          required
          bind:value={createName}
        >
      </div>
      <Dialog.Footer>
        <Button onclick={() => (createOpen = false)} type="button" variant="outline">Cancel</Button>
        <Button type="submit">Create</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={chmodOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Change permissions</Dialog.Title>
      <Dialog.Description>/{target.path || target.name}</Dialog.Description>
    </Dialog.Header>
    <form
      action="?/chmod"
      class="space-y-4"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't change the permissions.",
        loading: "Changing the permissions",
        onSuccess: () => {
          chmodOpen = false;
        },
        success: (result) => `Mode set to ${String(result?.mode ?? chmodMode)}.`,
      })}
    >
      <input name="path" type="hidden" value={target.path}>
      <div>
        <label class={labelClass} for="entry-mode">Octal mode</label>
        <input
          id="entry-mode"
          class="{inputClass} font-mono"
          autocomplete="off"
          inputmode="numeric"
          maxlength="4"
          name="mode"
          pattern={"[0-7]{3,4}"}
          placeholder="644"
          required
          title="3 or 4 octal digits, like 644 or 0755"
          bind:value={chmodMode}
        >
      </div>
      <Dialog.Footer>
        <Button onclick={() => (chmodOpen = false)} type="button" variant="outline">Cancel</Button>
        <Button type="submit">Apply</Button>
      </Dialog.Footer>
    </form>
  </Dialog.Content>
</Dialog.Root>

<form
  bind:this={deleteForm}
  action="?/delete"
  hidden
  method="POST"
  use:enhance={enhanceToast({
    error: "Couldn't delete it.",
    loading: "Deleting",
    success: "Deleted.",
  })}
>
  <input name="path" type="hidden" value={target.path}>
</form>

<ConfirmDialog
  bind:open={deleteOpen}
  confirmLabel="Delete"
  description={target.kind === "directory"
    ? `Delete the folder "${target.name}" and everything in it? This can't be undone.`
    : `Delete "${target.name}"? This can't be undone.`}
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Delete {target.kind === 'directory' ? 'folder' : 'file'}"
/>
