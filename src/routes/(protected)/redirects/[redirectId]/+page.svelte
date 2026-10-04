<script lang="ts">
	import { onMount } from "svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import RedirectFields from "#lib/components/redirect-fields.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data, form } = $props();

	const item = $derived(data.redirect);

	onMount(() => title.set("Edit Redirect"));

	let submitting = $state(false);
</script>

<div class="p-5 md:p-6">
  <div class="mb-8">
    <h1 class="text-text text-lg font-semibold tracking-tight">{item.source}</h1>
    <p class="text-text-muted mt-1 text-sm">
      Changes are live in Traefik within a moment of saving.
    </p>
  </div>

  <section class="panel mb-6 rounded-md">
    <PanelHeader title="Redirect">
      {#snippet trailing()}
        <SaveButton form="redirect-settings" pending={submitting} />
      {/snippet}
    </PanelHeader>
    <form
      id="redirect-settings"
      action="?/update"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving the redirect",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Redirect saved.",
      })}
    >
      {#if form?.error}
        <p class="text-sm text-red-500">{form.error}</p>
      {/if}
      <RedirectFields values={item} />
    </form>
  </section>
</div>
