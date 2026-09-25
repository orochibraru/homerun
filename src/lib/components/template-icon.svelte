<script lang="ts">
	import type { Component } from "svelte";
	import { templateCategoryColor, templateCategoryIcon } from "$lib/constants";
	import { hasIconImage, iconSrc } from "$lib/service-icon";

	const {
		icon,
		category = null,
		class: className = "size-10",
		fallback,
	}: {
		icon: string | null;
		category?: string | null;
		class?: string;
		fallback?: Component;
	} = $props();

	const color = $derived(templateCategoryColor(category));
</script>

{#if hasIconImage(icon)}
  <div
    class="flex shrink-0 items-center justify-center rounded-md bg-surface-2 p-2 {className}"
  >
    <img alt="" class="size-full object-contain" src={iconSrc(icon)}>
  </div>
{:else}
  {@const Icon = !category && fallback ? fallback : templateCategoryIcon(category)}
  <div
    class="flex shrink-0 items-center justify-center rounded-md {color.bg} {color.text} {className}"
  >
    <Icon class="size-1/2" />
  </div>
{/if}
