<script lang="ts">
	import { ChevronRight, Plug } from "@lucide/svelte";
	import ObjectStoreFields from "#lib/components/object-store-fields.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let connecting = $state(false);
	let formKey = $state(0);
</script>

{#if data.stores.length > 0}
  <div class="panel mb-6 overflow-x-auto rounded-md">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
          <th class="px-4 py-3 font-medium">Store</th>
          <th class="hidden px-4 py-3 font-medium md:table-cell">Endpoint</th>
          <th class="hidden px-4 py-3 font-medium md:table-cell">Region</th>
          <th class="w-8 px-4 py-3"><span class="sr-only">Open</span></th>
        </tr>
      </thead>
      <tbody>
        {#each data.stores as store (store.id)}
          <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
            <td class="px-4 py-3">
              <a
                class="text-text group-hover:text-accent font-medium after:absolute after:inset-0"
                href={store.kind === "garage"
                  ? resolve("/(protected)/object-storage/built-in")
                  : resolve("/(protected)/object-storage/stores/[storeId]", {
                      storeId: store.id,
                    })}
              >
                {store.name}
              </a>
            </td>
            <td class="text-text-muted hidden px-4 py-3 font-mono text-xs md:table-cell">
              {store.kind === "garage" ? "Built in" : store.endpoint}
            </td>
            <td class="text-text-muted hidden px-4 py-3 md:table-cell">{store.region}</td>
            <td class="text-text-subtle px-4 py-3"><ChevronRight class="size-4" /></td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<section class="panel rounded-md">
  <PanelHeader
    description="Any S3-compatible provider: AWS S3, Google Cloud Storage's interoperability keys, Hetzner Object Storage, Cloudflare R2, MinIO. Homerun lists buckets with the keys before saving them."
    icon={Plug}
    title="Connect a store"
  >
    {#snippet trailing()}
      <SaveButton form="connect-store" label="Connect" pending={connecting} />
    {/snippet}
  </PanelHeader>
  {#key formKey}
    <form
      id="connect-store"
      class="px-5 py-4"
      action="?/create"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't connect that store.",
        loading: "Checking the store",
        onSettled: () => {
          connecting = false;
        },
        onStart: () => {
          connecting = true;
        },
        onSuccess: () => {
          formKey += 1;
        },
        success: "Store connected.",
      })}
    >
      <ObjectStoreFields />
    </form>
  {/key}
</section>
