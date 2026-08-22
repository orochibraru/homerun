<script lang="ts">
	import { Check, LayoutGrid, Plus, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EnvPasteButton from "$lib/components/env-paste-button.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { mergeEnvRows, type ParsedEnvVar } from "$lib/env-parse";
	import { title } from "$lib/store/title";

	const { form } = $props();

	onMount(() => title.set("New Template"));

	const label = "block mb-1.5 text-sm font-medium text-text";
	const errorClass = "mt-1.5 text-xs text-red-500";
	const values = $derived(form?.values as Record<string, string> | undefined);
	const errors = $derived(form?.errors as Record<string, string[]> | undefined);

	const categoryOptions = [
		{ label: "None", value: "" },
		{ label: "Database", value: "database" },
		{ label: "Cache", value: "cache" },
		{ label: "Monitoring", value: "monitoring" },
		{ label: "Automation", value: "automation" },
		{ label: "Other", value: "other" },
	];
	let category = $derived(values?.category ?? "");
	const categoryLabel = $derived(
		categoryOptions.find((c) => c.value === category)?.label ?? "None",
	);

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

	function importEnvRows(imported: ParsedEnvVar[]) {
		envRows = mergeEnvRows(envRows, imported, (row) => row);
	}
</script>

<div class="mspace-y-6 p-6 md:p-8">
  <div class="mb-3">
    <h1 class="text-xl font-bold text-text">New Template</h1>
    <p class="text-sm text-text-muted">
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
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <LayoutGrid class="size-4" />
        </div>
        <h2 class="text-sm font-semibold text-text">Basics</h2>
      </div>

      <div class="space-y-5 p-5">
        <div>
          <label class={label} for="name">
            Name <span class="text-red-500">*</span>
          </label>
          <Input
            id="name"
            name="name"
            placeholder="My stack"
            required
            type="text"
            value={values?.name ?? ""}
          />
          {#if errors?.name}
            <p class={errorClass}>{errors.name[0]}</p>
          {/if}
        </div>

        <div>
          <label class={label} for="description">Description</label>
          <Textarea
            class="resize-none"
            content={values?.description ?? ""}
            id="description"
            name="description"
            placeholder="Optional"
            rows={2}
          />
        </div>

        <div>
          <label class={label} for="category">Category</label>
          <Select.Root name="category" type="single" bind:value={category}>
            <Select.Trigger class="w-full" id="category">
              {categoryLabel}
            </Select.Trigger>
            <Select.Content>
              {#each categoryOptions as opt (opt.value)}
                <Select.Item label={opt.label} value={opt.value} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>

        <div class="grid grid-cols-3 gap-3">
          <div class="col-span-2">
            <label class={label} for="image">
              Image <span class="text-red-500">*</span>
            </label>
            <Input
              id="image"
              name="image"
              placeholder="ghcr.io/acme/api"
              required
              type="text"
              value={values?.image ?? ""}
            />
            {#if errors?.image}
              <p class={errorClass}>{errors.image[0]}</p>
            {/if}
          </div>
          <div>
            <label class={label} for="tag">Tag</label>
            <Input
              id="tag"
              name="tag"
              placeholder="latest"
              type="text"
              value={values?.tag ?? "latest"}
            />
          </div>
        </div>

        <div>
          <label class={label} for="containerPort">
            Container port <span class="text-red-500">*</span>
          </label>
          <Input
            id="containerPort"
            max="65535"
            min="1"
            name="containerPort"
            placeholder="3000"
            required
            type="number"
            value={values?.containerPort ?? ""}
          />
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
            <Input
              class="font-mono"
              name="envKey"
              placeholder="KEY"
              type="text"
              bind:value={row.key}
            />
            <Input
              class="font-mono"
              name="envValue"
              placeholder="value"
              type="text"
              bind:value={row.value}
            />
            <Button
              aria-label="Remove"
              class="shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-500"
              onclick={() => removeEnvRow(i)}
              size="icon-sm"
              variant="ghost"
            >
              <Trash2 class="size-4" />
            </Button>
          </div>
        {/each}
        <div class="mt-1 flex items-center gap-4">
          <Button class="h-auto p-0" onclick={addEnvRow} variant="link">
            <Plus class="size-3.5" />
            Add variable
          </Button>
          <EnvPasteButton onImport={importEnvRows} />
        </div>
      </div>
    </section>

    <div class="flex justify-end gap-3">
      <Button href={resolve("/templates")} variant="outline">Cancel</Button>
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Creating…
        {:else}
          <Check class="size-4" />
          Create template
        {/if}
      </Button>
    </div>
  </form>
</div>
