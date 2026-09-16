<script lang="ts">
	import { Check } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("New Stack"));

	const label = "block mb-1.5 text-sm font-medium text-text";

	let submitting = $state(false);
	let name = $state("");
	let slug = $state("");
	let slugTouched = $state(false);

	function slugify(value: string): string {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "")
			.slice(0, 63);
	}

	function onNameInput() {
		if (!slugTouched) {
			slug = slugify(name);
		}
	}

	function onSlugInput() {
		slugTouched = true;
	}
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-text text-lg font-semibold tracking-tight">New Stack</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      Group related services together.
    </p>
  </div>

  <form
    action="?/create"
    class="space-y-5 rounded-md panel p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Creating the stack",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Stack created.",
    })}
  >
    {#if form?.error}
      <Alert>
        {form.error}
      </Alert>
    {/if}

    <div>
      <label class={label} for="name">
        Name <span class="text-red-500">*</span>
      </label>
      <Input
        id="name"
        name="name"
        oninput={onNameInput}
        placeholder="e.g. Marketing site"
        required
        type="text"
        bind:value={name}
      />
    </div>

    <div>
      <label class={label} for="slug">
        Slug <span class="text-red-500">*</span>
      </label>
      <Input
        class=""
        id="slug"
        name="slug"
        oninput={onSlugInput}
        pattern={"[a-z0-9-]{1,63}"}
        placeholder="marketing-site"
        required
        type="text"
        bind:value={slug}
      />
      <p class="mt-1.5 text-xs text-text-subtle">
        Prefixes every member service's container name and subdomain (e.g.
        <code>{slug || "slug"}-my-service.example.com</code>).
      </p>
    </div>

    <div>
      <label class={label} for="description">Description</label>
      <Textarea
        class="resize-none"
        id="description"
        name="description"
        placeholder="Optional"
        rows={3}
      />
    </div>

    <div class="flex justify-end gap-3">
      <Button href={resolve("/stacks")} variant="outline">Cancel</Button>
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Creating…
        {:else}
          <Check class="size-4" />
          Create stack
        {/if}
      </Button>
    </div>
  </form>
</div>
