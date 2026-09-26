<script lang="ts">
	import {
		ArrowLeft,
		Check,
		ChevronRight,
		File,
		Folder,
		Link2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import Alert from "$lib/components/alert.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { formatBytes, timeAgo } from "$lib/formatting";
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
      <textarea
        class="panel text-text focus:border-accent min-h-[28rem] w-full rounded-md p-3 font-mono text-[0.8125rem] leading-relaxed focus:outline-none"
        aria-label="File content"
        name="content"
        spellcheck="false"
        bind:value={content}
      ></textarea>
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
  <nav aria-label="Folder" class="mb-3 flex flex-wrap items-center gap-1 text-sm">
    <a class="text-text-muted hover:text-text" href={dirHref("")}>{vol.name}</a>
    {#each crumbs as crumb (crumb.path)}
      <ChevronRight class="text-text-subtle size-3.5" />
      <a class="text-text-muted hover:text-text" href={dirHref(crumb.path)}>
        {crumb.name}
      </a>
    {/each}
  </nav>
  {#if data.listing.entries.length === 0}
    <div class="border-border/70 rounded-md border border-dashed py-12 text-center">
      <p class="text-text-muted text-sm">This folder is empty.</p>
    </div>
  {:else}
    <div class="panel divide-border divide-y overflow-hidden rounded-xl">
      {#each data.listing.entries as entry (entry.path)}
        {@const Icon = entry.kind === "directory" ? Folder : entry.kind === "link" ? Link2 : File}
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
      {/each}
    </div>
  {/if}
{/if}
