<script lang="ts">
	import BrandMark from "#lib/components/brand-mark.svelte";
	import type { AuthBranding } from "#lib/error-pages.js";

	interface Props {
		branding: AuthBranding | null;
		class?: string;
		size?: "lg" | "sm";
	}

	const { branding, class: className = "", size = "sm" }: Props = $props();
</script>

{#if !branding}
  <BrandMark class={className} {size} />
{:else if branding.logoUrl}
  <img
    class="w-auto {size === 'lg' ? 'h-8' : 'h-6'} {className}"
    alt={branding.brandName}
    src={branding.logoUrl}
  />
{:else}
  <span
    class="text-text font-semibold tracking-tight {size === 'lg'
      ? 'text-lg'
      : 'text-[0.95rem]'} {className}"
  >
    {branding.brandName}
  </span>
{/if}
