<script lang="ts">
	import { Database, Plus } from "@lucide/svelte";
	import Alert from "#lib/components/alert.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import ObjectStoreSelect from "#lib/components/object-store-select.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import BucketTable from "./bucket-table.svelte";

	const { data } = $props();

	let storeId = $state("");
	let bucket = $state("");
	let creating = $state(false);

	$effect(() => {
		if (!storeId && data.stores.length > 0) {
			storeId = data.stores[0].id;
		}
	});
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
  <section class="panel mb-6 rounded-md">
    <PanelHeader
      description="Bucket names are global on most providers: 3 to 63 lowercase letters, digits, dots or dashes."
      icon={Plus}
      title="New bucket"
    />
    <form
      action="?/createBucket"
      class="grid gap-4 px-5 py-4 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)_auto] sm:items-end"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create that bucket.",
        loading: "Creating the bucket",
        onSettled: () => {
          creating = false;
        },
        onStart: () => {
          creating = true;
        },
        onSuccess: () => {
          bucket = "";
        },
        success: "Bucket created.",
      })}
    >
      <div>
        <label class={labelClass} for="bucketStore">Store</label>
        <ObjectStoreSelect
          id="bucketStore"
          name="storeId"
          stores={data.stores}
          bind:value={storeId}
        />
      </div>
      <div>
        <label class={labelClass} for="bucketName">Name</label>
        <input
          id="bucketName"
          class={inputClass}
          autocomplete="off"
          name="bucket"
          placeholder="tfstate"
          required
          bind:value={bucket}
        />
      </div>
      <Button disabled={creating || !bucket || !storeId} type="submit">
        Create bucket
      </Button>
    </form>
  </section>

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
        <p class="text-text-muted text-sm">No buckets yet. Create one above.</p>
      </div>
    {:else}
      <BucketTable rows={listing.rows} />
    {/if}
  {/await}
{/if}
