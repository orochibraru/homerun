<script lang="ts">
	import { Boxes, Trash2 } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import Alert from "$lib/components/alert.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { formatBytes } from "$lib/formatting";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	const totalTags = $derived(
		data.catalog.reduce((sum, entry) => sum + entry.tags.length, 0),
	);

	let confirmOpen = $state(false);
	let confirmTitle = $state("");
	let confirmDescription = $state("");
	let confirmForm: HTMLFormElement | null = null;

	function requestConfirm(
		event: MouseEvent,
		title: string,
		description: string,
	) {
		confirmForm = (event.currentTarget as HTMLElement).closest("form");
		confirmTitle = title;
		confirmDescription = description;
		confirmOpen = true;
	}

	function confirmPending() {
		confirmForm?.requestSubmit();
	}
</script>

{#if data.unreachable}
  <Alert class="mb-6" title="The registry isn't answering.">
    {data.unreachable}
  </Alert>
{/if}

<div
  class="border-border bg-surface-1 mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
>
  <div class="text-sm">
    <p class="text-text font-medium">
      {data.catalog.length}
      {data.catalog.length === 1 ? "repository" : "repositories"}, {totalTags}
      {totalTags === 1 ? "tag" : "tags"}
    </p>
    <p class="text-text-muted mt-0.5">
      {#if data.status.sizeBytes !== null}
        {formatBytes(data.status.sizeBytes)} on disk. Deleting a tag only frees
        its space once garbage collection runs.
      {:else}
        Deleting a tag only frees its space once garbage collection runs.
      {/if}
    </p>
  </div>
  <form
    action="?/collectGarbage"
    method="POST"
    use:enhance={enhanceToast({
      error: "Garbage collection failed.",
      loading: "Collecting garbage",
      success: "Garbage collection finished.",
    })}
  >
    <Button type="submit" variant="outline">Collect garbage</Button>
  </form>
</div>

{#if data.catalog.length === 0}
  <EmptyState
    icon={Boxes}
    subtitle="Homerun mirrors an image here the first time it scans one, and anything you push lands here too."
    title="Nothing in the registry yet"
  />
{:else}
  <div class="flex flex-col gap-4">
    {#each data.catalog as entry (entry.repository)}
      <section class="border-border bg-surface-1 rounded-lg border">
        <header
          class="border-border flex items-center justify-between gap-3 border-b px-4 py-3"
        >
          <div class="min-w-0">
            <h2 class="text-text font-mono text-sm font-medium break-all">
              {entry.repository}
            </h2>
            <p class="text-text-muted mt-0.5 text-xs">
              {#if entry.usedBy.length > 0}
                Used by {entry.usedBy.join(", ")}
              {:else}
                Not referenced by any service
              {/if}
            </p>
          </div>
          <form
            class="shrink-0"
            action="?/deleteRepository"
            method="POST"
            use:enhance={enhanceToast({
              error: "Couldn't delete that repository.",
              loading: `Deleting ${entry.repository}`,
              success: "Repository deleted.",
            })}
          >
            <input name="repository" type="hidden" value={entry.repository} />
            <Button
              onclick={(event: MouseEvent) =>
                requestConfirm(
                  event,
                  `Delete ${entry.repository}?`,
                  "Deletes every tag in it. A service already running one of these images keeps running, but nothing can pull it again until it's mirrored or pushed back.",
                )}
              size="sm"
              type="button"
              variant="ghost"
            >
              <Trash2 class="size-3.5" />
              Delete all
            </Button>
          </form>
        </header>
        <ul class="divide-border divide-y">
          {#each entry.tags as tag (tag.tag)}
            <li class="flex items-center justify-between gap-3 px-4 py-2.5">
              <div class="min-w-0">
                <span class="text-text font-mono text-sm break-all">{tag.tag}</span>
                {#if tag.digest}
                  <span class="text-text-muted ml-2 font-mono text-xs">
                    {tag.digest.slice(0, 19)}
                  </span>
                {/if}
              </div>
              <form
                action="?/deleteTag"
                method="POST"
                use:enhance={enhanceToast({
                  error: "Couldn't delete that tag.",
                  loading: `Deleting ${entry.repository}:${tag.tag}`,
                  success: "Tag deleted.",
                })}
              >
                <input
                  name="repository"
                  type="hidden"
                  value={entry.repository}
                />
                <input name="tag" type="hidden" value={tag.tag} />
                <Button
                  onclick={(event: MouseEvent) =>
                    requestConfirm(
                      event,
                      `Delete ${entry.repository}:${tag.tag}?`,
                      "Registry deletes work on the manifest, so any other tag pointing at the same image goes with it.",
                    )}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <Trash2 class="size-3.5" />
                </Button>
              </form>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
{/if}

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Delete"
  description={confirmDescription}
  onConfirm={confirmPending}
  title={confirmTitle}
/>
