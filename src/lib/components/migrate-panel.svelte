<script lang="ts">
	import { ArrowLeft, Container, Database, Layers } from "@lucide/svelte";
	import type { Component } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import type {
		MigrationEntryKind,
		MigrationFormState,
	} from "$lib/migrate/common";
	import { enhanceToast } from "$lib/toast";

	const {
		form,
		label: sourceLabel,
		tokenHelp,
		urlPlaceholder,
	}: {
		form: MigrationFormState;
		label: string;
		tokenHelp: string;
		urlPlaceholder: string;
	} = $props();

	let pending = $state<"import" | "preview" | null>(null);
	let picked = $state<Set<string>>(new Set());
	let preview = $state<NonNullable<MigrationFormState>["preview"] | null>(null);

	const entries = $derived(preview?.entries ?? []);
	const importable = $derived(entries.filter((entry) => !entry.blocked));
	const selectedIds = $derived(
		importable.filter((entry) => picked.has(entry.id)).map((entry) => entry.id),
	);

	$effect(() => {
		if (form?.preview) {
			preview = form.preview;
			picked = new Set(
				form.preview.entries
					.filter((entry) => !entry.blocked)
					.map((entry) => entry.id),
			);
		}
	});

	function toggle(id: string) {
		const next = new Set(picked);
		if (next.has(id)) {
			next.delete(id);
		} else {
			next.add(id);
		}
		picked = next;
	}

	function toggleAll() {
		picked =
			selectedIds.length === importable.length
				? new Set()
				: new Set(importable.map((entry) => entry.id));
	}

	const ICONS: Record<MigrationEntryKind, Component> = {
		application: Container,
		compose: Layers,
		database: Database,
	};
</script>

<a
  class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
  href={resolve("/settings/migrate")}
>
  <ArrowLeft class="size-3.5" />
  All sources
</a>

{#if form?.result}
  <Alert
    class="mb-6"
    title="Import finished."
    variant={form.result.skipped.length > 0 ? "warning" : "success"}
  >
    Imported {form.result.imported.reduce((sum, item) => sum + item.services, 0)}
    service(s) from {form.result.imported.length} entr{form.result.imported.length === 1 ? "y" : "ies"}.
    Nothing was deployed : deploy each one from its page when you're ready.
    {#if form.result.skipped.length > 0}
      <ul class="mt-2 list-disc pl-5">
        {#each form.result.skipped as skip (skip.name)}
          <li>{skip.name} : {skip.reason}</li>
        {/each}
      </ul>
    {/if}
    {#snippet actions()}
      <Button href={resolve("/services")} size="sm" variant="outline">
        Go to services
      </Button>
    {/snippet}
  </Alert>
{/if}

<form
  action="?/preview"
  method="POST"
  use:enhance={(input) => {
    const importing = input.action.search === "?/import";
    return enhanceToast({
      error: importing
        ? "The import failed."
        : `Couldn't read that ${sourceLabel} instance.`,
      loading: importing
        ? `Importing from ${sourceLabel}`
        : `Reading the ${sourceLabel} instance`,
      onSettled: () => {
        pending = null;
      },
      onStart: () => {
        pending = importing ? "import" : "preview";
      },
      onSuccess: () => {
        if (importing) {
          preview = null;
        }
      },
      success: importing
        ? "Import finished."
        : "Read it : review what would be imported below.",
    })(input);
  }}
>
  <section class="panel mb-6 rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Migrate from {sourceLabel}</h2>
      <p class="text-text-muted text-xs">
        Reads the projects on a {sourceLabel} instance and recreates them here.
        It only ever reads : nothing on the {sourceLabel} side is stopped,
        changed or deleted, and nothing imported here is deployed until you say
        so.
      </p>
    </div>
    <div class="space-y-4 p-5">
      <div class="grid gap-4 sm:grid-cols-2">
        <div>
          <label class={label} for="baseUrl">{sourceLabel} URL</label>
          <Input
            id="baseUrl"
            name="baseUrl"
            placeholder={urlPlaceholder}
            required
            type="url"
            value={form?.values?.baseUrl ?? ""}
          />
        </div>
        <div>
          <label class={label} for="token">API token</label>
          <Input
            autocomplete="off"
            id="token"
            name="token"
            required
            type="password"
          />
          <p class="text-text-subtle mt-1.5 text-xs">{tokenHelp}</p>
        </div>
      </div>
      {#if form?.error}
        <Alert title="Couldn't finish that.">{form.error}</Alert>
      {/if}
      <div class="flex justify-end">
        <Button disabled={pending !== null} type="submit" variant="outline">
          {#if pending === "preview"}
            <Spinner />
            Reading…
          {:else}
            Read instance
          {/if}
        </Button>
      </div>
    </div>
  </section>

  {#if preview}
    {#each selectedIds as id (id)}
      <input name="ids" type="hidden" value={id}>
    {/each}
    <section class="panel rounded-md">
      <div class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
        <div>
          <h2 class="eyebrow">Dry run</h2>
          <p class="text-text-muted mt-1 text-xs">
            {importable.length} importable of {entries.length} found, across
            {preview.projects.length} project(s). Each {sourceLabel} project
            becomes a stack here. Nothing is created until you import.
          </p>
        </div>
        <div class="flex items-center gap-2">
          {#if importable.length > 0}
            <Button onclick={toggleAll} size="sm" type="button" variant="ghost">
              {selectedIds.length === importable.length
                ? "Select none"
                : "Select all"}
            </Button>
          {/if}
          <Button
            disabled={pending !== null || selectedIds.length === 0}
            formaction="?/import"
            size="sm"
            type="submit"
          >
            {#if pending === "import"}
              <Spinner />
              Importing…
            {:else}
              Import {selectedIds.length} selected
            {/if}
          </Button>
        </div>
      </div>
      {#if entries.length === 0}
        <p class="text-text-muted px-5 py-8 text-center text-sm">
          {sourceLabel} returned no applications, compose stacks or databases.
        </p>
      {/if}
      <div class="divide-border divide-y">
        {#each entries as entry (entry.id)}
          {@const Icon = ICONS[entry.kind]}
          <div class="flex items-start gap-3 px-5 py-3">
            <Checkbox
              aria-label={`Import ${entry.name}`}
              checked={picked.has(entry.id)}
              class="mt-0.5"
              disabled={!!entry.blocked}
              onCheckedChange={() => toggle(entry.id)}
            />
            <Icon class="text-text-muted mt-0.5 size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-text truncate text-sm font-medium">
                {entry.name}
                <span class="text-text-subtle font-mono text-xs">
                  · {entry.projectName}
                </span>
              </p>
              <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
                {entry.summary}
              </p>
              {#if entry.blocked}
                <p class="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                  {entry.blocked}
                </p>
              {:else}
                <ul class="mt-1 space-y-0.5">
                  {#each entry.services as svc (svc.slug)}
                    <li class="text-text-subtle font-mono text-xs">
                      {svc.slug} · port {svc.port} · {svc.public
                        ? "public"
                        : "internal"} · {svc.envCount} env · {svc.volumeCount}
                      volume(s)
                      {#if svc.slugTaken}
                        <span class="text-amber-600 dark:text-amber-400">
                          · slug taken, gets a numbered one
                        </span>
                      {/if}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#each entry.warnings as warning, index (index)}
                <p class="text-text-subtle mt-0.5 text-xs">⚠ {warning}</p>
              {/each}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</form>
