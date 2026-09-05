<script lang="ts">
	import { Check } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import NewVolumeFields from "$lib/components/new-volume-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New Volume"));

	let submitting = $state(false);
	let kind = $state<"bind" | "volume">("volume");
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-text text-xl font-semibold tracking-tight">New Volume</h1>
    <p class="text-text-muted mt-0.5 text-sm">
      A local storage source services can mount for persistent or shared data.
    </p>
  </div>

  <form
    action="?/create"
    class="glass space-y-5 rounded-2xl p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Creating the volume",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Volume created.",
    })}
  >
    {#if form?.error}
      <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
        {form.error}
      </div>
    {/if}

    <NewVolumeFields bind:kind />

    <div class="flex justify-end gap-3">
      <Button href={resolve("/storage")} variant="outline">Cancel</Button>
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Creating…
        {:else}
          <Check class="size-4" />
          Create volume
        {/if}
      </Button>
    </div>
  </form>
</div>
