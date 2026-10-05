<script lang="ts">
	import { ArrowLeft, Plug, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import ObjectStoreFields from "#lib/components/object-store-fields.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set(`Object Storage · ${data.store.name}`));

	let saving = $state(false);
	let confirmOpen = $state(false);
	let deleteForm: HTMLFormElement | undefined = $state();
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/object-storage/stores")}
  >
    <ArrowLeft class="size-4" />
    All stores
  </a>

  <section class="panel rounded-md">
    <PanelHeader
      description="Saving lists buckets with the new settings first, so a typo can't land."
      icon={Plug}
      title={data.store.name}
    >
      {#snippet trailing()}
        <form
          action="?/test"
          method="POST"
          use:enhance={enhanceToast({
            error: "The store didn't answer.",
            loading: "Testing the store",
            success: (result) =>
              `It answers: ${String(result?.buckets ?? 0)} buckets visible.`,
          })}
        >
          <Button size="sm" type="submit" variant="outline">Test</Button>
        </form>
        <SaveButton form="edit-store" pending={saving} />
      {/snippet}
    </PanelHeader>
    <form
      id="edit-store"
      class="px-5 py-4"
      action="?/update"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the store.",
        loading: "Checking the store",
        onSettled: () => {
          saving = false;
        },
        onStart: () => {
          saving = true;
        },
        success: "Store saved.",
      })}
    >
      <ObjectStoreFields
        accessKeyId={data.store.accessKeyId}
        endpoint={data.store.endpoint}
        keepSecret
        name={data.store.name}
        region={data.store.region}
      />
    </form>
  </section>

  <form
    bind:this={deleteForm}
    action="?/delete"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't remove the store.",
      loading: "Removing the store",
      onSuccess: () => goto(resolve("/(protected)/object-storage/stores")),
      success: "Store removed.",
    })}
  >
    <Button
      onclick={() => {
        confirmOpen = true;
      }}
      type="button"
      variant="outline"
    >
      <Trash2 class="size-3.5" />
      Remove store
    </Button>
  </form>
</div>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Remove"
  description="Homerun forgets the connection and every Terraform state project kept on it. The buckets and their objects stay on the provider."
  onConfirm={() => deleteForm?.requestSubmit()}
  title="Remove {data.store.name}?"
/>
