<script lang="ts">
	import { Boxes, ChevronRight } from "@lucide/svelte";
	import Alert from "#lib/components/alert.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityToolbar from "#lib/components/entity-toolbar.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { formatBytes } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data } = $props();

	const TAG_PREVIEW = 4;
</script>

<div
  class="border-border bg-surface-1 mb-6 flex flex-wrap items-center justify-between gap-4 rounded-lg border p-4"
>
  <p class="text-text-muted text-sm">
    {#if data.status.sizeBytes !== null}
      {formatBytes(data.status.sizeBytes)} on disk. Deleting a tag only frees its
      space once garbage collection runs.
    {:else}
      Deleting a tag only frees its space once garbage collection runs.
    {/if}
  </p>
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

{#await data.listing}
  <div class="space-y-2">
    {#each { length: 6 }, i (i)}
      <Skeleton class="h-12 w-full" />
    {/each}
  </div>
{:then listing}
  {#if listing.unreachable}
    <Alert class="mb-6" title="The registry isn't answering.">
      {listing.unreachable}
    </Alert>
  {/if}
  {#if listing.total === 0 && !data.searched}
    <EmptyState
      icon={Boxes}
      subtitle="Homerun mirrors an image here the first time it scans one, and anything you push lands here too."
      title="Nothing in the registry yet"
    />
  {:else}
    <EntityToolbar placeholder="Search repositories…" />
    {#if listing.items.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No repository matches your search.</p>
      </div>
    {:else}
      <div class="panel overflow-x-auto rounded-md">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Repository</th>
              <th class="px-4 py-3 font-medium">Tags</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Used by</th>
              <th class="w-8 px-4 py-3"><span class="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {#each listing.items as entry (entry.repository)}
              {@const href = resolve("/(protected)/registry/images/[...repository]", {
                repository: entry.repository,
              })}
              <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
                <td class="px-4 py-3">
                  <a
                    class="text-text group-hover:text-accent font-mono font-medium break-all after:absolute after:inset-0"
                    {href}
                  >
                    {entry.repository}
                  </a>
                </td>
                <td class="px-4 py-3">
                  <span class="flex flex-wrap items-center gap-1.5">
                    {#each entry.tags.slice(0, TAG_PREVIEW) as tag (tag.tag)}
                      <span class="bg-surface-2 text-text-muted rounded px-1.5 py-0.5 font-mono text-xs">
                        {tag.tag}
                      </span>
                    {/each}
                    {#if entry.tags.length > TAG_PREVIEW}
                      <span class="text-text-subtle text-xs">
                        +{entry.tags.length - TAG_PREVIEW} more
                      </span>
                    {/if}
                  </span>
                </td>
                <td class="text-text-muted hidden px-4 py-3 md:table-cell">
                  {entry.usedBy.length > 0
                    ? entry.usedBy.map((svc) => svc.name).join(", ")
                    : "—"}
                </td>
                <td class="text-text-subtle px-4 py-3">
                  <ChevronRight class="size-4" />
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pagination
        label="repositories"
        page={listing.page}
        perPage={listing.perPage}
        total={listing.total}
      />
    {/if}
  {/if}
{/await}
