<script lang="ts">
  import { Check } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Input } from "$lib/components/ui/input/index.js";
  import Spinner from "$lib/components/ui/spinner/spinner.svelte";
  import { Textarea } from "$lib/components/ui/textarea/index.js";
  import { title } from "$lib/store/title";

  const { form } = $props();

  onMount(() => title.set("New Project"));

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
    <h1 class="text-xl font-bold text-text">New Project</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      Group related services together.
    </p>
  </div>

  <form
    action="?/create"
    class="space-y-5 rounded-2xl border border-border bg-surface p-5"
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
        class="font-mono"
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
      <Button href={resolve("/projects")} variant="outline">Cancel</Button>
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Creating…
        {:else}
          <Check class="size-4" />
          Create project
        {/if}
      </Button>
    </div>
  </form>
</div>
