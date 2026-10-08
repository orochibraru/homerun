<script lang="ts">
	import { ArrowLeft, FileCode2 } from "@lucide/svelte";
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
    href={resolve("/(protected)/iac/state")}
  >
    <ArrowLeft class="size-4" />
    All state backends
  </a>

  <section class="panel rounded-md">
    <PanelHeader
      description="One Terraform state, kept in a bucket you pick (created if it doesn't exist). Every write is kept as a version you can compare or roll back to, and the lock lives in Homerun."
      icon={FileCode2}
      title="New state backend"
    >
      {#snippet trailing()}
        <SaveButton
          disabled={data.stores.length === 0}
          form="new-state-project"
          label="Create"
          pending={creating}
        />
      {/snippet}
    </PanelHeader>
    {#if data.stores.length === 0}
      <p class="text-text-muted px-5 py-4 text-sm">
        <a class="text-accent hover:underline" href={resolve("/(protected)/object-storage/built-in")}>Turn on the built-in store or connect one</a>
        first: the state lives in one of its buckets.
      </p>
    {:else}
      <form
        id="new-state-project"
        class="grid gap-4 px-5 py-4 sm:grid-cols-2"
        action="?/create"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't create the backend.",
          loading: "Creating the backend",
          onSettled: () => {
            creating = false;
          },
          onStart: () => {
            creating = true;
          },
          onSuccess: (result) => {
            if (typeof result?.projectId === "string") {
              void goto(
                resolve("/(protected)/iac/state/[projectId]", {
                  projectId: result.projectId,
                }),
              );
            }
          },
          success: "Backend created.",
        })}
      >
        <div>
          <label class={labelClass} for="projectName">Name</label>
          <input
            id="projectName"
            class={inputClass}
            autocomplete="off"
            name="name"
            placeholder="homelab"
            required
          />
        </div>
        <div>
          <label class={labelClass} for="projectStore">Store</label>
          <ObjectStoreSelect
            id="projectStore"
            name="storeId"
            stores={data.stores}
            bind:value={storeId}
          />
        </div>
        <div>
          <label class={labelClass} for="projectBucket">Bucket</label>
          <input
            id="projectBucket"
            class={inputClass}
            autocomplete="off"
            name="bucket"
            placeholder="tfstate"
            required
          />
        </div>
        <div>
          <label class={labelClass} for="projectPrefix">Folder in the bucket</label>
          <input
            id="projectPrefix"
            class={inputClass}
            autocomplete="off"
            name="prefix"
            placeholder="Optional, e.g. terraform"
          />
        </div>
      </form>
    {/if}
  </section>
</div>
