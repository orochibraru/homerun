<script lang="ts">
	import { Check } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import NewVolumeFields from "$lib/components/new-volume-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	const { form } = $props();

	onMount(() => title.set("New Volume"));

	let submitting = $state(false);
	let kind = $state<"bind" | "volume">("volume");
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-text text-xl font-bold">New Volume</h1>
    <p class="text-text-muted mt-0.5 text-sm">
      A local storage source services can mount for persistent or shared data.
    </p>
  </div>

  <form
    action="?/create"
    class="border-border bg-surface space-y-5 rounded-2xl border p-5"
    method="POST"
    use:enhance={() => {
      submitting = true;
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === "failure") {
          toast.error("Check the form for errors.");
        }
        await update();
      };
    }}
  >
    {#if form?.error}
      <div
        class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
      >
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
