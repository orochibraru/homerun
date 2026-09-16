<script lang="ts">
	import { ListChecks, Plus, RefreshCw } from "@lucide/svelte";
	import { untrack } from "svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { listStatusCheckNames } from "$lib/remote/status-checks.remote";

	interface Props {
		enabled: boolean;
		error?: string;
		gitRef: string;
		gitUrl: string;
		labelClass: string;
		selected: string[];
	}

	const {
		enabled: initialEnabled,
		error,
		gitRef,
		gitUrl,
		labelClass,
		selected: initialSelected,
	}: Props = $props();

	let enabled = $state(untrack(() => initialEnabled));
	let selected = $state<string[]>(untrack(() => [...initialSelected]));
	let namesPromise = $state<Promise<string[]> | null>(null);
	let loaded = $state<string[]>([]);
	let custom = $state("");

	const shown = $derived([...new Set([...loaded, ...selected])]);

	function load() {
		if (!gitUrl) {
			namesPromise = null;
			return;
		}
		const pending = listStatusCheckNames({ gitRef: gitRef || "main", gitUrl });
		namesPromise = pending;
		pending
			.then((names) => {
				loaded = names;
			})
			.catch(() => {
				loaded = [];
			});
	}

	function toggle(name: string, on: boolean) {
		selected = on
			? [...selected.filter((entry) => entry !== name), name]
			: selected.filter((entry) => entry !== name);
	}

	function addCustom() {
		const name = custom.trim();
		if (name && !selected.includes(name)) {
			selected = [...selected, name];
		}
		custom = "";
	}

	$effect(() => {
		if (enabled && !namesPromise && untrack(() => gitUrl)) {
			untrack(load);
		}
	});
</script>

<div class="border-border space-y-3 rounded-md border p-4">
  <div class="flex items-center gap-2">
    <ListChecks class="text-text-muted size-4" />
    <p class="text-text text-sm font-medium">Status checks</p>
  </div>
  <CheckBox
    helperText="Before cloning, read the CI results for the commit about to be built from the git provider. Every selected check has to pass, otherwise the build stops and your notification channels are told why."
    id="requireStatusChecks"
    label="Require status checks to pass before building"
    name="requireStatusChecks"
    bind:checked={enabled}
  />

  {#each selected as name (name)}
    <input name="requiredStatusChecks" type="hidden" value={name}>
  {/each}

  {#if enabled}
    <div class="space-y-2">
      <div class="flex items-center justify-between gap-2">
        <p class={labelClass}>Required checks</p>
        <Button
          disabled={!gitUrl}
          onclick={load}
          size="sm"
          type="button"
          variant="ghost"
        >
          <RefreshCw class="size-3.5" />
          Reload from {gitRef || "main"}
        </Button>
      </div>

      {#if namesPromise}
        {#await namesPromise}
          <p class="text-text-muted flex items-center gap-2 text-xs">
            <Spinner />
            Reading the checks on the latest commits of {gitRef || "main"}…
          </p>
        {:then names}
          {#if names.length === 0}
            <p class="text-text-muted text-xs">
              No checks have reported on the latest commits of this branch yet.
              Add one by name below.
            </p>
          {/if}
        {:catch err}
          <p class="text-xs text-amber-600">
            Couldn't read checks from the provider: {err?.body?.message ?? err?.message ?? "unknown error"}
          </p>
        {/await}
      {:else if !gitUrl}
        <p class="text-text-muted text-xs">Set the repository URL first.</p>
      {/if}

      {#if shown.length > 0}
        <div class="grid gap-2 sm:grid-cols-2">
          {#each shown as name (name)}
            <label
              class="border-border has-aria-checked:border-accent has-aria-checked:bg-accent-light flex items-center gap-2 rounded-md border px-3 py-2 text-sm"
            >
              <Checkbox
                checked={selected.includes(name)}
                onCheckedChange={(on) => toggle(name, on)}
              />
              <span class="truncate font-mono text-xs">{name}</span>
              {#if !loaded.includes(name)}
                <span class="text-text-subtle ml-auto text-[0.6875rem]">
                  not seen recently
                </span>
              {/if}
            </label>
          {/each}
        </div>
      {/if}

      <div class="flex gap-2">
        <Input
          aria-label="Check name"
          onkeydown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              addCustom();
            }
          }}
          placeholder="Add a check by name, e.g. build / test"
          type="text"
          bind:value={custom}
        />
        <Button onclick={addCustom} type="button" variant="outline">
          <Plus class="size-4" />
          Add
        </Button>
      </div>
      {#if error}
        <p class="mt-1.5 text-xs text-red-500">{error}</p>
      {/if}
    </div>
  {/if}
</div>
