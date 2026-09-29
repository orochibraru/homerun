<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import RedirectFields from "$lib/components/redirect-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

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

  <form
    action="?/update"
    class="panel mb-6 space-y-4 rounded-md p-5"
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
    <div class="flex justify-end gap-3">
      <Button disabled={submitting} type="submit" variant="outline">
        Save changes
      </Button>
    </div>
  </form>
</div>
