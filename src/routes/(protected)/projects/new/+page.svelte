<script lang="ts">
  import { Check, Loader2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import { title } from "$lib/store/title";

  const { form } = $props();

  onMount(() => title.set("New Project"));

  const input =
    "w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-2.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-subtle)] transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
  const label = "block mb-1.5 text-sm font-medium text-[var(--color-text)]";

  let submitting = $state(false);
</script>

<div class="mx-auto max-w-lg space-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-xl font-bold text-[var(--color-text)]">New Project</h1>
    <p class="mt-0.5 text-sm text-[var(--color-text-muted)]">
      Group related services together.
    </p>
  </div>

  <form
    action="?/create"
    class="space-y-5 rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5"
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
      <input
        class={input}
        id="name"
        name="name"
        placeholder="e.g. Marketing site"
        required
        type="text"
      >
    </div>

    <div>
      <label class={label} for="description">Description</label>
      <textarea
        class="{input} resize-none"
        id="description"
        name="description"
        placeholder="Optional"
        rows="3"
      ></textarea>
    </div>

    <div class="flex justify-end gap-3">
      <a
        class="rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)]"
        href={resolve("/projects")}
      >
        Cancel
      </a>
      <button
        class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {#if submitting}
          <Loader2 class="size-4 animate-spin" />
          Creating…
        {:else}
          <Check class="size-4" />
          Create project
        {/if}
      </button>
    </div>
  </form>
</div>
