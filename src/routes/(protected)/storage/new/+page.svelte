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

  onMount(() => title.set("New Volume"));

  const label = "block mb-1.5 text-sm font-medium text-text";

  let submitting = $state(false);
  let kind = $state<"bind" | "volume">("volume");
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-xl font-bold text-text">New Volume</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      A local storage source services can mount for persistent or shared data.
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
        placeholder="e.g. Media library"
        required
        type="text"
      />
    </div>

    <div>
      <p class={label}>Type</p>
      <div class="grid grid-cols-2 gap-3">
        <label
          class="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition-all {kind ===
          'volume'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted'}"
        >
          <input
            class="sr-only"
            name="kind"
            type="radio"
            value="volume"
            bind:group={kind}
          />
          Docker volume
        </label>
        <label
          class="flex cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm transition-all {kind ===
          'bind'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted'}"
        >
          <input
            class="sr-only"
            name="kind"
            type="radio"
            value="bind"
            bind:group={kind}
          />
          Host path
        </label>
      </div>
    </div>

    <div>
      <label class={label} for="source">
        {kind === "bind" ? "Host path" : "Volume name"}
        <span class="text-red-500">*</span>
      </label>
      <Input
        class="font-mono"
        id="source"
        name="source"
        placeholder={kind === "bind" ? "/mnt/data/media" : "homerun-media"}
        required
        type="text"
      />
      <p class="mt-1 text-xs text-text-subtle">
        {#if kind === "bind"}
          An absolute directory on this host — created automatically if it
          doesn't exist.
        {:else}
          A Docker-managed named volume — created automatically on first use.
        {/if}
      </p>
    </div>

    <div>
      <label class={label} for="description">Description</label>
      <Textarea
        class="resize-none"
        id="description"
        name="description"
        placeholder="Optional"
        rows={2}
      />
    </div>

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
