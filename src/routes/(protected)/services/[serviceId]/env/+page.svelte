<script lang="ts">
  import {
    Check,
    Loader2,
    Plus,
    SlidersHorizontal,
    Trash2,
  } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { title } from "$lib/store/title";

  const { data } = $props();
  const svc = $derived(data.service);

  onMount(() => title.set(`${svc.name} · Env Vars`));

  const input =
    "w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-subtle transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] font-mono";

  interface EnvRow {
    key: string;
    value: string;
  }
  let envRows = $state<EnvRow[]>(
    Object.entries(svc.envVars ?? {}).length > 0
      ? Object.entries(svc.envVars ?? {}).map(([key, value]) => ({
          key,
          value,
        }))
      : [{ key: "", value: "" }]
  );
  let submitting = $state(false);

  function addRow() {
    envRows.push({ key: "", value: "" });
  }

  function removeRow(i: number) {
    envRows.splice(i, 1);
    if (envRows.length === 0) {
      envRows.push({ key: "", value: "" });
    }
  }
</script>

<section class="rounded-2xl border border-border bg-surface">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div
      class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
    >
      <SlidersHorizontal class="size-4" />
    </div>
    <div>
      <h2 class="text-sm font-semibold text-text">Environment variables</h2>
      <p class="text-xs text-text-muted">
        Changes take effect on the next deploy — hit Redeploy on Overview after
        saving.
      </p>
    </div>
  </div>

  <form
    action="?/update"
    class="space-y-2.5 p-5"
    method="POST"
    use:enhance={() => {
      submitting = true;
      return async ({ result, update }) => {
        submitting = false;
        if (result.type === "success") toast.success("Saved.");
        if (result.type === "failure") toast.error("Couldn't save.");
        await update();
      };
    }}
  >
    {#each envRows as row, i}
      <div class="flex items-center gap-2">
        <input
          class={input}
          name="envKey"
          placeholder="KEY"
          type="text"
          bind:value={row.key}
        >
        <input
          class={input}
          name="envValue"
          placeholder="value"
          type="text"
          bind:value={row.value}
        >
        <button
          aria-label="Remove"
          class="shrink-0 rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10"
          onclick={() => removeRow(i)}
          type="button"
        >
          <Trash2 class="size-4" />
        </button>
      </div>
    {/each}

    <button
      class="text-accent mt-1 flex items-center gap-1.5 text-sm font-medium hover:underline"
      onclick={addRow}
      type="button"
    >
      <Plus class="size-3.5" />
      Add variable
    </button>

    <div class="flex justify-end pt-2">
      <button
        class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
        disabled={submitting}
        type="submit"
      >
        {#if submitting}
          <Loader2 class="size-4 animate-spin" />
          Saving…
        {:else}
          <Check class="size-4" />
          Save
        {/if}
      </button>
    </div>
  </form>
</section>
