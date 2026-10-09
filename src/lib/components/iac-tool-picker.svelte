<script lang="ts">
	import { Boxes, FileCode2, Sprout } from "@lucide/svelte";
	import type { Component } from "svelte";
	import { IAC_TOOL_INFO, IAC_TOOLS, type IacTool } from "#lib/iac/tools.js";

	interface Props {
		name: string;
		value: IacTool;
	}

	let { name, value = $bindable() }: Props = $props();

	const icons: Record<IacTool, Component> = {
		opentofu: Sprout,
		pulumi: Boxes,
		terraform: FileCode2,
	};
</script>

<input {name} type="hidden" {value}>
<div class="grid grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] gap-3" role="radiogroup">
  {#each IAC_TOOLS as tool (tool)}
    {@const Icon = icons[tool]}
    <button
      aria-checked={value === tool}
      class="flex items-start gap-3 rounded-md border p-3 text-left transition-colors {value === tool
        ? 'border-accent bg-accent-light'
        : 'border-border hover:bg-surface-2'}"
      onclick={() => {
        value = tool;
      }}
      role="radio"
      type="button"
    >
      <Icon class="text-accent mt-0.5 size-4 shrink-0" />
      <span>
        <span class="text-text block text-sm font-medium">{IAC_TOOL_INFO[tool].label}</span>
        <span class="text-text-muted block text-xs">{IAC_TOOL_INFO[tool].description}</span>
      </span>
    </button>
  {/each}
</div>
