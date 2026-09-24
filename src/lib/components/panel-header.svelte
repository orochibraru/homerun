<script lang="ts">
	import type { Component, Snippet } from "svelte";

	interface Props {
		class?: string;
		description?: string | Snippet;
		icon?: Component<{ class?: string }>;
		title: string;
		trailing?: Snippet;
	}

	const {
		class: className = "",
		description,
		icon: Icon,
		title,
		trailing,
	}: Props = $props();
</script>

<div class="border-border flex items-center gap-3 border-b px-5 py-4 {className}">
  {#if Icon}
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <Icon class="size-4" />
    </div>
  {/if}
  <div class="min-w-0 flex-1">
    <h2 class="eyebrow">{title}</h2>
    {#if typeof description === "string"}
      <p class="text-text-muted text-xs">{description}</p>
    {:else if description}
      <p class="text-text-muted text-xs">{@render description()}</p>
    {/if}
  </div>
  {#if trailing}
    {@render trailing()}
  {/if}
</div>
