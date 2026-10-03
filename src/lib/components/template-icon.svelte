<script lang="ts">
	import { mode } from "mode-watcher";
	import type { Component } from "svelte";
	import {
		templateCategoryColor,
		templateCategoryIcon,
	} from "#lib/constants.js";
	import { hasIconImage, type IconTheme, iconSrc } from "#lib/service-icon.js";

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
	let failed = $state<string | null>(null);
	let theme = $state<IconTheme>();

	$effect(() => {
		theme = mode.current;
	});
</script>

{#if hasIconImage(icon) && failed !== icon}
  <div
    class="flex shrink-0 items-center justify-center rounded-md bg-surface-2 p-2 {className}"
  >
    <img
      alt=""
      class="size-full object-contain"
      onerror={() => {
        failed = icon;
      }}
      src={iconSrc(icon, theme)}
    >
  </div>
{:else}
  {@const Icon = !category && fallback ? fallback : templateCategoryIcon(category)}
  <div
    class="flex shrink-0 items-center justify-center rounded-md {color.bg} {color.text} {className}"
  >
    <Icon class="size-1/2" />
  </div>
{/if}
