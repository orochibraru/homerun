<script lang="ts">
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import RedirectFields from "$lib/components/redirect-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New Redirect"));

	let submitting = $state(false);
</script>

<div class="p-5 md:p-6">
  <div class="mb-8">
    <h1 class="text-text text-lg font-semibold tracking-tight">Add a redirect</h1>
    <p class="text-text-muted mt-1 text-sm">
      Send a hostname, or a path under it, to another URL.
    </p>
  </div>

  <form
    action="?/create"
    class="panel mb-6 space-y-4 rounded-md p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Adding the redirect",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      onSuccess: () => goto(resolve("/redirects"), { invalidateAll: true }),
      success: "Redirect added.",
    })}
  >
    {#if form?.error}
      <p class="text-sm text-red-500">{form.error}</p>
    {/if}
    <RedirectFields
      values={{
        destination: "",
        enabled: true,
        keepPath: true,
        permanent: true,
        source: "",
      }}
    />
    <div class="flex justify-end gap-3">
      <Button disabled={submitting} type="submit" variant="outline">
        Add redirect
      </Button>
    </div>
  </form>
</div>
