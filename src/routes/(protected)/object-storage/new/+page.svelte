<script lang="ts">
	import { ArrowLeft, Plus } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import ObjectStoreSelect from "#lib/components/object-store-select.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let storeId = $state("");
	let bucket = $state("");
	let isPublic = $state(false);
	let creating = $state(false);

	$effect(() => {
		if (!storeId && data.stores.length > 0) {
			storeId = data.stores[0].id;
		}
	});
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/object-storage")}
  >
    <ArrowLeft class="size-4" />
    All buckets
  </a>

  <section class="panel rounded-md">
    <PanelHeader
      description="Bucket names are global on most providers: 3 to 63 lowercase letters, digits, dots or dashes."
      icon={Plus}
      title="New bucket"
    >
      {#snippet trailing()}
        <SaveButton
          disabled={!bucket || !storeId}
          form="new-bucket"
          label="Create bucket"
          pending={creating}
        />
      {/snippet}
    </PanelHeader>
    <form
      id="new-bucket"
      class="grid gap-4 px-5 py-4 sm:grid-cols-2"
      action="?/createBucket"
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
        onSuccess: async (result) => {
          if (typeof result?.bucket === "string" && typeof result.storeId === "string") {
            await goto(
              resolve("/(protected)/object-storage/[storeId]/buckets/[bucket]", {
                bucket: result.bucket,
                storeId: result.storeId,
              }),
            );
          }
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
          placeholder="assets"
          required
          bind:value={bucket}
        />
      </div>
      <div class="sm:col-span-2">
        <CheckBox
          helperText="Anyone with a link can download its objects, through this instance, without signing in. Listing and uploading still need a key."
          id="bucketPublic"
          label="Public"
          name="public"
          bind:checked={isPublic}
        />
      </div>
    </form>
  </section>
</div>
