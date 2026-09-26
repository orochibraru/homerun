<script lang="ts">
	import {
		Check,
		FileText,
		Lock,
		LockOpen,
		Plus,
		SlidersHorizontal,
		Trash2,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import EnvPasteButton from "$lib/components/env-paste-button.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { mergeEnvRows, type ParsedEnvVar } from "$lib/env-parse";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Env Vars`));

	interface EnvRow {
		key: string;
		secret: boolean;
		value: string;
	}
	function envRowsFromService(): EnvRow[] {
		const secret = new Set(svc.secretEnvKeys);
		const entries = Object.entries(svc.envVars ?? {}).map(([key, value]) => ({
			key,
			secret: secret.has(key),
			value,
		}));
		return entries.length > 0
			? entries
			: [{ key: "", secret: false, value: "" }];
	}

	// $state, not $derived: pushed/spliced into directly below
	// (addRow/removeRow), a $derived value is read-only, so mutating it
	// doesn't reliably stick. Seeded once at init; re-synced whenever `svc`
	// changes (a saved env-var update reloads the page via use:enhance's
	// default refreshAll, and the layout's own status-sync can also
	// refresh `data.service` on revisit).
	let envRows = $state<EnvRow[]>(envRowsFromService());
	$effect(() => {
		envRows = envRowsFromService();
	});
	let submitting = $state(false);

	function addRow() {
		envRows.push({ key: "", secret: false, value: "" });
	}

	function removeRow(i: number) {
		envRows.splice(i, 1);
		if (envRows.length === 0) {
			envRows.push({ key: "", secret: false, value: "" });
		}
	}

	function importRows(imported: ParsedEnvVar[]) {
		envRows = mergeEnvRows(envRows, imported, (row) => ({
			...row,
			secret: false,
		}));
	}
</script>

<div class="space-y-6">
<section class="rounded-md panel">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <SlidersHorizontal class="size-4" />
    </div>
    <div>
      <h2 class="eyebrow">Environment variables</h2>
      <p class="text-xs text-text-muted">
        Changes take effect on the next deploy : hit Redeploy on Overview after
        saving. The lock marks a value secret: it's hidden here and always
        redacted for AI agents, whatever its name.
      </p>
    </div>
  </div>

  <form
    action="?/update"
    class="space-y-2.5 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save.",
      loading: "Saving environment variables",
      onSettled: () => {
        submitting = false;
      },
      onStart: () => {
        submitting = true;
      },
      success: "Saved.",
    })}
  >
    {#each envRows as row, i}
      <div class="flex items-center gap-2">
        <Input
          class=""
          name="envKey"
          placeholder="KEY"
          type="text"
          bind:value={row.key}
        />
        <Input
          class=""
          autocomplete="off"
          name="envValue"
          placeholder="value"
          type={row.secret ? "password" : "text"}
          bind:value={row.value}
        />
        {#if row.secret}
          <input name="envSecret" type="hidden" value={row.key} />
        {/if}
        <Button
          aria-label={row.secret ? "Unmark as secret" : "Mark as secret"}
          aria-pressed={row.secret}
          class="shrink-0 {row.secret ? 'text-accent' : 'text-text-subtle'}"
          onclick={() => {
            row.secret = !row.secret;
          }}
          size="icon-sm"
          title={row.secret
            ? "Secret: hidden here and always redacted for AI agents"
            : "Mark as secret"}
          variant="ghost"
        >
          {#if row.secret}
            <Lock class="size-4" />
          {:else}
            <LockOpen class="size-4" />
          {/if}
        </Button>
        <Button
          aria-label="Remove"
          class="shrink-0 text-red-500 hover:bg-red-500/10 hover:text-red-500"
          onclick={() => removeRow(i)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 class="size-4" />
        </Button>
      </div>
    {/each}

    <div class="mt-1 flex items-center gap-4">
      <Button class="h-auto p-0" onclick={addRow} variant="link">
        <Plus class="size-3.5" />
        Add variable
      </Button>
      <EnvPasteButton onImport={importRows} />
    </div>

    <div class="flex justify-end pt-2">
      <Button disabled={submitting} type="submit">
        {#if submitting}
          <Spinner />
          Saving…
        {:else}
          <Check class="size-4" />
          Save
        {/if}
      </Button>
    </div>
  </form>
</section>

<section class="panel rounded-md">
  <div class="border-border flex items-center gap-3 border-b px-5 py-4">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <FileText class="size-4" />
    </div>
    <div>
      <h2 class="eyebrow">Env files</h2>
      <p class="text-text-muted text-xs">
        <code>.env</code> files on this host, read at every deploy. Variables
        above win over a file's, and a later file wins over an earlier one. A
        file that can't be read fails the deploy.
      </p>
    </div>
  </div>

  {#if !data.isAdmin}
    <div class="space-y-2 p-5 text-xs">
      {#if (svc.envFiles ?? []).length > 0}
        <ul class="text-text font-mono">
          {#each svc.envFiles ?? [] as path (path)}
            <li>{path}</li>
          {/each}
        </ul>
      {:else}
        <p class="text-text-muted">No env files.</p>
      {/if}
      <p class="text-text-subtle">
        Only an admin can change env files : they're read from the host.
      </p>
    </div>
  {:else}
  <form
    action="?/updateEnvFiles"
    class="space-y-3 p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save the env files.",
      loading: "Saving env files",
      success: "Saved.",
    })}
  >
    <Textarea
      class="min-h-20 font-mono text-xs"
      aria-label="Env file paths"
      name="envFiles"
      placeholder="/opt/my-app/.env"
      value={(svc.envFiles ?? []).join("\n")}
    />
    <p class="text-text-subtle text-xs">One absolute path per line.</p>
    {#if form?.envFilesError}
      <p class="text-xs text-red-500">{form.envFilesError}</p>
    {/if}
    <div class="flex justify-end">
      <Button type="submit" variant="outline">Save env files</Button>
    </div>
  </form>
  {/if}
</section>
</div>
