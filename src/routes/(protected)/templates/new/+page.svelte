<script lang="ts">
  import { Check, LayoutGrid, Loader2, Plus, Trash2 } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import { title } from "$lib/store/title";

  const { form } = $props();

  onMount(() => title.set("New Template"));

  const input =
    "w-full rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text placeholder:text-text-subtle transition-all focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]";
  const label = "block mb-1.5 text-sm font-medium text-text";
  const errorClass = "mt-1.5 text-xs text-red-500";
  const values = $derived(form?.values as Record<string, string> | undefined);
  const errors = $derived(form?.errors as Record<string, string[]> | undefined);

  let submitting = $state(false);

  interface EnvRow {
    key: string;
    value: string;
  }
  let envRows = $state<EnvRow[]>([{ key: "", value: "" }]);

  function addEnvRow() {
    envRows.push({ key: "", value: "" });
  }

  function removeEnvRow(i: number) {
    envRows.splice(i, 1);
    if (envRows.length === 0) {
      envRows.push({ key: "", value: "" });
    }
  }
</script>

<div class="mspace-y-6 p-6 md:p-8">
  <div>
    <h1 class="text-xl font-bold text-text">New Template</h1>
    <p class="mt-0.5 text-sm text-text-muted">
      A reusable config you can deploy from again later.
    </p>
  </div>

  <form
    action="?/create"
    class="space-y-6"
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
    <section class="rounded-2xl border border-border bg-surface">
      <div class="flex items-center gap-3 border-b border-border px-5 py-4">
        <div
          class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
        >
          <LayoutGrid class="size-4" />
        </div>
        <h2 class="text-sm font-semibold text-text">Basics</h2>
      </div>

      <div class="space-y-5 p-5">
        <div>
          <label class={label} for="name">
            Name <span class="text-red-500">*</span>
          </label>
          <input
            class={input}
            id="name"
            name="name"
            placeholder="My stack"
            required
            type="text"
            value={values?.name ?? ""}
          >
          {#if errors?.name}
            <p class={errorClass}>{errors.name[0]}</p>
          {/if}
        </div>

        <div>
          <label class={label} for="description">Description</label>
          <textarea
            class="{input} resize-none"
            id="description"
            name="description"
            placeholder="Optional"
            rows="2"
          >
            {values?.description ?? ""}
          </textarea>
        </div>

        <div>
          <label class={label} for="category">Category</label>
          <select class={input} id="category" name="category">
            <option value="">None</option>
            <option value="database">Database</option>
            <option value="cache">Cache</option>
            <option value="monitoring">Monitoring</option>
            <option value="automation">Automation</option>
            <option value="other">Other</option>
          </select>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class={label} for="image">
              Image <span class="text-red-500">*</span>
            </label>
            <input
              class={input}
              id="image"
              name="image"
              placeholder="ghcr.io/acme/api"
              required
              type="text"
              value={values?.image ?? ""}
            >
            {#if errors?.image}
              <p class={errorClass}>{errors.image[0]}</p>
            {/if}
          </div>
          <div>
            <label class={label} for="tag">Tag</label>
            <input
              class={input}
              id="tag"
              name="tag"
              placeholder="latest"
              type="text"
              value={values?.tag ?? "latest"}
            >
          </div>
        </div>

        <div>
          <label class={label} for="containerPort">
            Container port <span class="text-red-500">*</span>
          </label>
          <input
            class={input}
            id="containerPort"
            max="65535"
            min="1"
            name="containerPort"
            placeholder="3000"
            required
            type="number"
            value={values?.containerPort ?? ""}
          >
          {#if errors?.containerPort}
            <p class={errorClass}>{errors.containerPort[0]}</p>
          {/if}
        </div>
      </div>
    </section>

    <section class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">Environment variables</h2>
      </div>
      <div class="space-y-2.5 p-5">
        {#each envRows as row, i}
          <div class="flex items-center gap-2">
            <input
              class="{input} font-mono"
              name="envKey"
              placeholder="KEY"
              type="text"
              bind:value={row.key}
            >
            <input
              class="{input} font-mono"
              name="envValue"
              placeholder="value"
              type="text"
              bind:value={row.value}
            >
            <button
              aria-label="Remove"
              class="shrink-0 rounded-lg p-2 text-red-500 transition-all hover:bg-red-500/10"
              onclick={() => removeEnvRow(i)}
              type="button"
            >
              <Trash2 class="size-4" />
            </button>
          </div>
        {/each}
        <button
          class="text-accent mt-1 flex items-center gap-1.5 text-sm font-medium hover:underline"
          onclick={addEnvRow}
          type="button"
        >
          <Plus class="size-3.5" />
          Add variable
        </button>
      </div>
    </section>

    <div class="flex justify-end gap-3">
      <a
        class="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-text transition-all hover:bg-surface-2"
        href={resolve("/templates")}
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
          Create template
        {/if}
      </button>
    </div>
  </form>
</div>
