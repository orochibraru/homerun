<script lang="ts">
	import { Building2, House, SlidersHorizontal } from "@lucide/svelte";
	import type { Component } from "svelte";
	import { UI_MODE_DESCRIPTIONS, UI_MODE_LABELS } from "#lib/ui-mode.js";

	interface Props {
		follow?: { description: string; label: string };
		name: string;
		simpleLabel?: string;
		advancedLabel?: string;
		value: string;
	}

	let {
		advancedLabel = UI_MODE_LABELS.advanced,
		follow,
		name,
		simpleLabel = UI_MODE_LABELS.simple,
		value = $bindable(),
	}: Props = $props();

	interface Option {
		description: string;
		icon: Component;
		label: string;
		value: string;
	}

	const options = $derived<Option[]>([
		{
			description: UI_MODE_DESCRIPTIONS.simple,
			icon: House,
			label: simpleLabel,
			value: "simple",
		},
		{
			description: UI_MODE_DESCRIPTIONS.advanced,
			icon: Building2,
			label: advancedLabel,
			value: "advanced",
		},
		...(follow
			? [
					{
						description: follow.description,
						icon: SlidersHorizontal,
						label: follow.label,
						value: "",
					},
				]
			: []),
	]);
</script>

<input {name} type="hidden" {value}>
<div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3" role="radiogroup">
  {#each options as option (option.value)}
    {@const Icon = option.icon}
    <button
      aria-checked={value === option.value}
      class="flex items-start gap-3 rounded-md border p-3 text-left transition-colors {value ===
      option.value
        ? 'border-accent bg-accent-light'
        : 'border-border hover:bg-surface-2'}"
      onclick={() => {
        value = option.value;
      }}
      role="radio"
      type="button"
    >
      <Icon class="text-accent mt-0.5 size-4 shrink-0" />
      <span>
        <span class="text-text block text-sm font-medium">{option.label}</span>
        <span class="text-text-muted block text-xs">{option.description}</span>
      </span>
    </button>
  {/each}
</div>
