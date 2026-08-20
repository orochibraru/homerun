<script lang="ts">
	import { Check, Plus, SlidersHorizontal, Trash2 } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Env Vars`));

	interface EnvRow {
		key: string;
		value: string;
	}
	let envRows = $derived<EnvRow[]>(
		Object.entries(svc.envVars ?? {}).length > 0
			? Object.entries(svc.envVars ?? {}).map(([key, value]) => ({
					key,
					value,
				}))
			: [{ key: "", value: "" }],
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
        if (result.type === "success") {
          toast.success("Saved.");
        }
        if (result.type === "failure") {
          toast.error("Couldn't save.");
        }
        await update();
      };
    }}
  >
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
          onclick={() => removeRow(i)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 class="size-4" />
        </Button>
      </div>
    {/each}

    <Button class="mt-1 h-auto p-0" onclick={addRow} variant="link">
      <Plus class="size-3.5" />
      Add variable
    </Button>

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
