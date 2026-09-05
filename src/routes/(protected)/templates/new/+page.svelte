<script lang="ts">
	import { Check, LayoutGrid, Link2, Plus, Trash2 } from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EnvPasteButton from "$lib/components/env-paste-button.svelte";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { mergeEnvRows, type ParsedEnvVar } from "$lib/env-parse";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

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
		{ label: "Media", value: "media" },
		{ label: "Network", value: "network" },
		{ label: "Dashboard", value: "dashboard" },
		{ label: "Productivity", value: "productivity" },
		{ label: "Finance", value: "finance" },
		{ label: "Analytics", value: "analytics" },
		{ label: "Development", value: "development" },
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

	let linkEnabled = $state<Record<string, boolean>>(
		untrack(() =>
			Object.fromEntries(data.linkableTemplates.map((t) => [t.id, false])),
		),
	);
	let linkAliases = $state<Record<string, string>>({});

	function slugify(value: string): string {
		return value
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9-]+/g, "-")
			.replace(/-+/g, "-")
			.replace(/^-|-$/g, "");
	}
</script>

<div class="mspace-y-6 p-6 md:p-8">
  <div class="mb-3">
    <h1 class="text-text text-xl font-semibold tracking-tight">New Template</h1>
    <p class="text-sm text-text-muted">
      A reusable config you can deploy from again later.
    </p>
  </div>

  <form
    action="?/create"
    class="space-y-6"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Creating the template",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Template created.",
    })}
  >
    <section class="rounded-2xl glass">
      <div class="flex items-center gap-3 border-b border-border px-5 py-4">
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <LayoutGrid class="size-4" />
        </div>
        <h2 class="eyebrow">Basics</h2>
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

    <section class="rounded-2xl glass">
      <div class="border-b border-border px-5 py-4">
        <h2 class="eyebrow">Environment variables</h2>
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

    {#if data.linkableTemplates.length > 0}
      <section class="rounded-2xl glass">
        <div class="flex items-center gap-3 border-b border-border px-5 py-4">
          <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
            <Link2 class="size-4" />
          </div>
          <div>
            <h2 class="eyebrow">Linked containers</h2>
            <p class="text-xs text-text-muted">
              Check any to deploy them alongside this template automatically,
              e.g. a database or cache. Each gets an alias (defaults to its
              name if you don't set one) that's also its internal hostname :
              reference it in an env var above as
              <code class="font-mono">{"{{alias}}"}</code> (or, for one of the
              linked container's own env vars,
              <code class="font-mono">{"{{alias.ENV_KEY}}"}</code>).
            </p>
          </div>
        </div>
        <div class="divide-y divide-border">
          {#each data.linkableTemplates as linkable (linkable.id)}
            {@const envEntries = Object.entries(linkable.envVars ?? {})}
            {@const enabled = linkEnabled[linkable.id] ?? false}
            <div class="flex items-start gap-3 px-5 py-3">
              <Checkbox
                class="mt-1"
                id="linkEnabled-{linkable.id}"
                bind:checked={linkEnabled[linkable.id]}
              />
              <TemplateIcon
                category={linkable.category}
                class="mt-0.5 size-6"
                icon={linkable.icon}
              />
              <label
                class="min-w-0 flex-1 cursor-pointer"
                for="linkEnabled-{linkable.id}"
              >
                <p class="truncate text-sm font-medium text-text">
                  {linkable.name}
                </p>
                <p class="truncate font-mono text-xs text-text-subtle">
                  {linkable.image}:{linkable.tag} · port {linkable.containerPort}
                </p>
                {#if envEntries.length > 0}
                  <p class="truncate font-mono text-xs text-text-subtle">
                    {envEntries.map(([k, v]) => `${k}=${v}`).join(", ")}
                  </p>
                {/if}
              </label>
              <Input
                class="w-32 shrink-0 font-mono"
                disabled={!enabled}
                name="linkAlias.{linkable.id}"
                placeholder={slugify(linkable.name)}
                type="text"
                bind:value={linkAliases[linkable.id]}
              />
              <input name="linkTemplateId" type="hidden" value={linkable.id}>
              <input
                name="linkEnabled"
                type="hidden"
                value={enabled ? "true" : "false"}
              >
            </div>
          {/each}
        </div>
      </section>
    {/if}

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
