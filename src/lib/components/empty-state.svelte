<script lang="ts">
	import type { Component, Snippet } from "svelte";

	const {
		icon: Icon,
		title,
		subtitle,
		children,
	}: {
		icon: Component<{ class?: string }>;
		title: string;
		subtitle?: string;
		children?: Snippet;
	} = $props();
</script>

<div class="border-border/70 flex flex-col items-center justify-center rounded-2xl border border-dashed py-20 text-center">
  <div class="glass mb-4 flex size-12 items-center justify-center rounded-xl">
    <Icon class="text-text-subtle size-5" />
  </div>
  <p class="text-text text-sm font-medium">{title}</p>
  {#if subtitle}
    <p class="text-text-subtle mt-1 text-xs">{subtitle}</p>
  {/if}
  {#if children}
    <div class="mt-5">
      {@render children()}
    </div>
  {/if}
</div>
