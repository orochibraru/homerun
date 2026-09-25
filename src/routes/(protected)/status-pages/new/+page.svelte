<script lang="ts">
	import { Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import StatusPageFields from "$lib/components/status-page-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import type { StatusPageScope } from "$lib/types";

	const { data, form } = $props();

	onMount(() => title.set("New status page"));

	let name = $state("");
	let slug = $state("");
	let description = $state("");
	let scope = $state<StatusPageScope>("global");
	let stackId = $state("");
	let isPublic = $state(false);
	let selectedServiceIds = $state<string[]>([]);
	let saving = $state(false);

	let slugTouched = $state(false);
	$effect(() => {
		if (!slugTouched) {
			slug = name
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, "-")
				.replace(/^-+|-+$/g, "");
		}
	});
</script>

<div class="p-5 md:p-6">
  <h1 class="text-text mb-6 text-lg font-semibold tracking-tight">
    New status page
  </h1>

  {#if form?.errors?.slug}
    <Alert class="mb-6">{form.errors.slug[0]}</Alert>
  {/if}

  <form
    class="panel space-y-6 rounded-md p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't create the status page.",
      loading: "Creating the status page",
      onSettled: () => {
        saving = false;
      },
      onStart: () => {
        saving = true;
      },
      success: "Status page created.",
    })}
  >
    <StatusPageFields
      bind:name
      bind:slug
      bind:description
      bind:scope
      bind:stackId
      bind:isPublic
      bind:selectedServiceIds
      errors={form?.errors}
      stacks={data.stacks}
      services={data.services}
    />

    <div class="flex justify-end gap-3">
      <Button href={resolve("/status-pages")} variant="outline">Cancel</Button>
      <Button disabled={saving} type="submit">
        <Plus class="size-4" />
        Create status page
      </Button>
    </div>
  </form>
</div>

<svelte:window
  onkeydown={() => {
    slugTouched = document.activeElement?.id === "slug" || slugTouched;
  }}
/>
