<script lang="ts">
	import { Database, Plus } from "@lucide/svelte";
	import Alert from "#lib/components/alert.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { resolve } from "$app/paths";
	import BucketTable from "./bucket-table.svelte";

	const { data } = $props();
</script>

{#if data.stores.length === 0}
  <EmptyState
    icon={Database}
    subtitle="Turn on the built-in store, or connect an S3-compatible provider, to create buckets."
    title="No object store yet"
  >
    <div class="mt-4 flex flex-wrap justify-center gap-2">
      <Button href={resolve("/(protected)/object-storage/built-in")}>
        Turn on the built-in store
      </Button>
      <Button
        href={resolve("/(protected)/object-storage/stores")}
        variant="outline"
      >
        Connect a store
      </Button>
    </div>
  </EmptyState>
{:else}
  <div class="mb-4 flex justify-end">
    <Button href={resolve("/(protected)/object-storage/new")} size="sm">
      <Plus class="size-4" />
      New bucket
    </Button>
  </div>

  {#await data.listing}
    <div class="space-y-2">
      {#each { length: 5 }, i (i)}
        <Skeleton class="h-12 w-full" />
      {/each}
    </div>
  {:then listing}
    {#each listing.failures as failure (failure.storeName)}
      <Alert class="mb-4" title="{failure.storeName} couldn't be listed.">
        {failure.message}
      </Alert>
    {/each}
    {#if listing.rows.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No buckets yet. Create one with New bucket.</p>
      </div>
    {:else}
      <BucketTable rows={listing.rows} />
    {/if}
  {/await}
{/if}
