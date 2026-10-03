<script lang="ts">
	import { Plus, X } from "@lucide/svelte";
	import { errorClass, inputClass } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";

	interface Props {
		addLabel: string;
		id: string;
		name: string;
		placeholder: string;
		preview?: (url: string) => string | null;
		validate: (url: string) => string | null;
		values: string[];
	}

	let {
		addLabel,
		id,
		name,
		placeholder,
		preview,
		validate,
		values = $bindable([]),
	}: Props = $props();

	let touched = $state<boolean[]>([]);
	let inputs = $state<HTMLInputElement[]>([]);

	/** Adds an empty row and focuses it. */
	async function add() {
		values.push("");
		await Promise.resolve();
		inputs[values.length - 1]?.focus();
	}

	/** Removes a row, keeping at least one empty row to type into. */
	function remove(index: number) {
		values.splice(index, 1);
		touched.splice(index, 1);
		if (values.length === 0) {
			values.push("");
		}
	}

	/** The row's validation message once it has been left, or null. */
	function problemAt(index: number): string | null {
		const value = values[index]?.trim() ?? "";
		return value && touched[index] ? validate(value) : null;
	}
</script>

<div class="space-y-2">
  {#each values as _, index (index)}
    {@const problem = problemAt(index)}
    {@const shown = values[index]?.trim() && !validate(values[index].trim()) ? preview?.(values[index].trim()) : null}
    <div>
      <div class="flex items-center gap-2">
        <input
          aria-invalid={problem ? "true" : undefined}
          aria-label="{addLabel} {index + 1}"
          autocomplete="off"
          class="{inputClass} font-mono text-xs {problem ? 'border-red-500/60' : ''}"
          id={index === 0 ? id : undefined}
          inputmode="url"
          {name}
          onblur={() => {
            touched[index] = true;
          }}
          {placeholder}
          spellcheck="false"
          type="text"
          bind:this={inputs[index]}
          bind:value={values[index]}
        >
        <Button
          aria-label="Remove"
          disabled={values.length === 1 && !values[0]}
          onclick={() => remove(index)}
          size="icon-sm"
          type="button"
          variant="ghost"
        >
          <X class="size-4" />
        </Button>
      </div>
      {#if problem}
        <p class={errorClass}>{problem}</p>
      {:else if shown}
        <p class="text-text-subtle mt-1 truncate font-mono text-[0.6875rem]" title={shown}>
          {shown}
        </p>
      {/if}
    </div>
  {/each}
  <Button onclick={add} size="sm" type="button" variant="outline">
    <Plus class="size-4" />
    {addLabel}
  </Button>
</div>
