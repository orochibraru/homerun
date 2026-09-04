<script lang="ts">
	import { templateCategoryColor, templateCategoryIcon } from "$lib/constants";

	const {
		icon,
		category = null,
		class: className = "size-10",
	}: {
		icon: string | null;
		category?: string | null;
		class?: string;
	} = $props();

	const isBundledLogo = $derived(!!icon && icon.includes("."));
	const color = $derived(templateCategoryColor(category));
</script>

{#if isBundledLogo}
  <div
    class="flex shrink-0 items-center justify-center rounded-xl bg-surface-2 p-2 {className}"
  >
    <img alt="" class="size-full object-contain" src="/template-icons/{icon}">
  </div>
{:else}
  {@const Icon = templateCategoryIcon(category)}
  <div
    class="flex shrink-0 items-center justify-center rounded-xl {color.bg} {color.text} {className}"
  >
    <Icon class="size-1/2" />
  </div>
{/if}
