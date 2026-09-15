<script lang="ts">
	import { ArrowLeft, Container, Database, Layers } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import type { DokployPlanItem } from "$lib/services/dokploy.service";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { form } = $props();

	onMount(() => title.set("Migrate from Dokploy"));

	let connecting = $state(false);
	let importing = $state(false);
	let picked = $state<Set<string>>(new Set());

	const plan = $derived(form?.plan ?? null);
	const items = $derived<DokployPlanItem[]>(plan?.items ?? []);
	const importable = $derived(items.filter((item) => !item.blocked));
	const selected = $derived(
		importable.filter((item) => picked.has(item.entry.id)),
	);

	$effect(() => {
		if (plan) {
			picked = new Set(importable.map((item) => item.entry.id));
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

	function iconFor(kind: DokployPlanItem["entry"]["kind"]) {
		if (kind === "compose") {
			return Layers;
		}
		return kind === "database" ? Database : Container;
	}
</script>

<div class="p-5 md:p-6">
  <a
    class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
    href={resolve("/services")}
  >
    <ArrowLeft class="size-3.5" />
    Services
  </a>

  <div class="mb-8">
    <h1 class="text-text text-lg font-semibold tracking-tight">
      Migrate from Dokploy
    </h1>
    <p class="text-text-muted mt-1 max-w-2xl text-sm">
      Reads the projects on a Dokploy instance and recreates them here. It only
      ever reads : nothing on the Dokploy side is stopped, changed or deleted,
      and nothing imported here is deployed until you say so.
    </p>
  </div>

  {#if form?.error}
    <Alert class="mb-6" title="Couldn't read that instance.">
      {form.error}
    </Alert>
  {/if}

  {#if form?.success}
    <Alert class="mb-6" title="Import finished." variant="success">
      Imported {form.result.imported.length} service(s).
      {#if form.result.skipped.length > 0}
        Skipped {form.result.skipped.length}:
        {form.result.skipped.map((s) => `${s.name} (${s.reason})`).join("; ")}
      {/if}
    </Alert>
    <Button onclick={() => goto(resolve("/services"))}>Go to services</Button>
  {:else}
    <form
      action="?/dryRun"
      class="panel mb-6 space-y-4 rounded-md p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't read that Dokploy instance.",
        loading: "Reading the Dokploy instance",
        onSettled: () => {
          connecting = false;
        },
        onStart: () => {
          connecting = true;
        },
        success: "Read it : review what would be imported below.",
      })}
    >
      <div>
        <label class={label} for="baseUrl">Dokploy URL</label>
        <Input
          id="baseUrl"
          name="baseUrl"
          placeholder="https://dokploy.example.com"
          required
          type="url"
          value={form?.values?.baseUrl ?? ""}
        />
      </div>
      <div>
        <label class={label} for="token">API token</label>
        <Input id="token" name="token" required type="password" />
        <p class="text-text-subtle mt-1.5 text-xs">
          Dokploy → Settings → API/CLI. Read-only use, and it isn't stored :
          it's used for this one request.
        </p>
      </div>
      <div class="flex justify-end">
        <Button disabled={connecting} type="submit" variant="outline">
          {#if connecting}
            <Spinner />
            Reading…
          {:else}
            Read instance
          {/if}
        </Button>
      </div>
    </form>

    {#if plan}
      <form
        action="?/import"
        method="POST"
        use:enhance={enhanceToast({
          error: "The import failed.",
          loading: "Importing",
          onSettled: () => {
            importing = false;
          },
          onStart: () => {
            importing = true;
          },
          success: "Imported.",
        })}
      >
        <input
          name="items"
          type="hidden"
          value={JSON.stringify(selected)}
        >
        <section class="panel rounded-md">
          <div class="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
            <div>
              <h2 class="eyebrow">Dry run</h2>
              <p class="text-text-muted mt-1 text-xs">
                {importable.length} importable of {items.length} found, across
                {plan.projects.length} project(s). Nothing is created until you
                approve.
              </p>
            </div>
            <Button disabled={importing || selected.length === 0} type="submit">
              {#if importing}
                <Spinner />
                Importing…
              {:else}
                Import {selected.length} service(s)
              {/if}
            </Button>
          </div>
          <div class="divide-border divide-y">
            {#each items as item (item.entry.id)}
              {@const Icon = iconFor(item.entry.kind)}
              <div class="flex items-center gap-3 px-5 py-3">
                <Checkbox
                  aria-label={`Import ${item.entry.name}`}
                  checked={picked.has(item.entry.id)}
                  disabled={!!item.blocked}
                  onCheckedChange={() => toggle(item.entry.id)}
                />
                <Icon class="text-text-muted size-4 shrink-0" />
                <div class="min-w-0 flex-1">
                  <p class="text-text truncate text-sm font-medium">
                    {item.entry.name}
                    <span class="text-text-subtle font-mono text-xs">
                      · {item.entry.projectName}
                    </span>
                  </p>
                  <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
                    {#if item.entry.kind === "compose"}
                      compose stack · {item.composeServiceCount} service(s)
                    {:else}
                      {item.image ?? "no image"}:{item.tag} · {item.slug}
                    {/if}
                  </p>
                  {#if item.blocked}
                    <p class="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                      {item.blocked}
                    </p>
                  {:else if item.slugTaken}
                    <p class="text-text-subtle mt-0.5 text-xs">
                      A service named <code>{item.slug}</code> already exists :
                      this one gets a numbered slug.
                    </p>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </section>
      </form>
    {/if}
  {/if}
</div>
