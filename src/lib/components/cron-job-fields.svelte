<script lang="ts">
	import { Plus, Trash2 } from "@lucide/svelte";
	import { untrack } from "svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import EnvPasteButton from "$lib/components/env-paste-button.svelte";
	import { inputClass, labelClass } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { mergeEnvRows, type ParsedEnvVar } from "$lib/env-parse";

	interface CronJobValues {
		command: string | null;
		description: string | null;
		enabled: boolean;
		envVars: Record<string, string>;
		image: string | null;
		kind: "image" | "exec";
		name: string;
		registryUrl: string | null;
		registryUsername: string | null;
		schedule: string;
		tag: string | null;
		timeoutSeconds: number;
	}

	const { canUseExec, values }: { canUseExec: boolean; values: CronJobValues } =
		$props();

	function initialEnvRows(): ParsedEnvVar[] {
		const rows = Object.entries(values.envVars).map(([key, value]) => ({
			key,
			value,
		}));
		return rows.length > 0 ? rows : [{ key: "", value: "" }];
	}

	let kind = $state<"image" | "exec">(untrack(() => values.kind));
	let showRegistry = $state(untrack(() => !!values.registryUsername));
	let envRows = $state<ParsedEnvVar[]>(untrack(initialEnvRows));

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

	function kindClass(value: "image" | "exec"): string {
		return value === kind
			? "border-accent bg-accent-light text-accent"
			: "border-border text-text-muted";
	}
</script>

<input name="kind" type="hidden" value={kind}>

<section class="glass space-y-4 rounded-2xl p-5">
  <div class="grid gap-3 sm:grid-cols-2">
    <div>
      <label class={labelClass} for="name">Name</label>
      <Input
        id="name"
        name="name"
        placeholder="Nightly database dump"
        type="text"
        value={values.name}
      />
    </div>
    <div>
      <label class={labelClass} for="schedule">Schedule (cron syntax)</label>
      <Input
        class="font-mono"
        id="schedule"
        name="schedule"
        placeholder="0 3 * * *"
        type="text"
        value={values.schedule}
      />
    </div>
  </div>

  <div>
    <label class={labelClass} for="description">Description (optional)</label>
    <Input
      id="description"
      name="description"
      placeholder="What this job does"
      type="text"
      value={values.description ?? ""}
    />
  </div>

  <div>
    <p class={labelClass}>Run as</p>
    <div class="flex gap-2">
      <button
        class="flex-1 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all {kindClass('image')}"
        onclick={() => {
          kind = "image";
        }}
        type="button"
      >
        Container
        <span class="text-text-subtle block text-xs font-normal">
          A throwaway container from an image
        </span>
      </button>
      <button
        class="flex-1 rounded-xl border px-3 py-2.5 text-left text-sm font-medium transition-all {kindClass('exec')}"
        disabled={!canUseExec}
        onclick={() => {
          kind = "exec";
        }}
        type="button"
      >
        Host command
        <span class="text-text-subtle block text-xs font-normal">
          {canUseExec
            ? "A shell command on the host running Homerun"
            : "Admins only"}
        </span>
      </button>
    </div>
  </div>

  {#if kind === "image"}
    <div class="grid gap-3 sm:grid-cols-3">
      <div class="sm:col-span-2">
        <label class={labelClass} for="image">Image</label>
        <Input
          class="font-mono"
          id="image"
          name="image"
          placeholder="postgres"
          type="text"
          value={values.image ?? ""}
        />
      </div>
      <div>
        <label class={labelClass} for="tag">Tag</label>
        <Input
          class="font-mono"
          id="tag"
          name="tag"
          placeholder="latest"
          type="text"
          value={values.tag ?? "latest"}
        />
      </div>
    </div>
  {/if}

  <div>
    <label class={labelClass} for="command">
      {kind === "exec" ? "Command" : "Command override (optional)"}
    </label>
    <Input
      class="font-mono"
      id="command"
      name="command"
      placeholder={kind === "exec"
        ? "/usr/local/bin/backup.sh"
        : 'pg_dump -h db app'}
      type="text"
      value={values.command ?? ""}
    />
    <p class="text-text-subtle mt-1 text-xs">
      {kind === "exec"
        ? "Runs through /bin/sh -c, with this app's own privileges."
        : "Blank runs the image's own entrypoint. Quotes group arguments; a JSON array is taken as-is."}
    </p>
  </div>

  <div>
    <label class={labelClass} for="timeoutSeconds">Timeout (seconds)</label>
    <Input
      id="timeoutSeconds"
      name="timeoutSeconds"
      placeholder="900"
      type="number"
      value={String(values.timeoutSeconds)}
    />
  </div>

  <CheckBox
    checked={values.enabled}
    helperText="Run this job on its schedule. Turn off to keep it around without it firing."
    id="enabled"
    label="Enable schedule"
    name="enabled"
  />
</section>

<section class="glass rounded-2xl">
  <div class="border-border border-b px-5 py-4">
    <h2 class="eyebrow">Environment variables</h2>
  </div>
  <div class="space-y-2.5 p-5">
    {#each envRows as row, i (i)}
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

{#if kind === "image"}
  <section class="glass rounded-2xl p-5">
    <Button
      class="h-auto p-0"
      onclick={() => {
        showRegistry = !showRegistry;
      }}
      variant="link"
    >
      {showRegistry ? "Hide" : "Use"} a private registry
    </Button>
    <div class="grid gap-3 sm:grid-cols-3" class:hidden={!showRegistry}>
      <div>
        <label class={labelClass} for="registryUrl">Registry URL</label>
        <Input
          class="font-mono"
          id="registryUrl"
          name="registryUrl"
          placeholder="ghcr.io"
          type="text"
          value={values.registryUrl ?? ""}
        />
      </div>
      <div>
        <label class={labelClass} for="registryUsername">Username</label>
        <Input
          id="registryUsername"
          name="registryUsername"
          type="text"
          value={values.registryUsername ?? ""}
        />
      </div>
      <div>
        <label class={labelClass} for="registryPassword">Password</label>
        <input
          class={inputClass}
          id="registryPassword"
          name="registryPassword"
          placeholder="Leave blank to keep the stored one"
          type="password"
        >
      </div>
    </div>
  </section>
{/if}
