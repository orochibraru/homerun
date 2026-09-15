<script lang="ts">
	import type { Snippet } from "svelte";
	import BrandMark from "$lib/components/brand-mark.svelte";

	interface Props {
		below?: Snippet;
		children: Snippet;
		eyebrow?: string;
		footer?: Snippet;
		heading: string;
		subheading?: string;
	}

	const { heading, subheading, eyebrow, children, below, footer }: Props =
		$props();
</script>

<div class="flex min-h-screen flex-col items-center justify-center px-6 py-12">
  <div class="w-full max-w-md">
    <BrandMark class="mb-8" size="lg" />

    <div class="mb-6">
      {#if eyebrow}
        <p class="eyebrow mb-2">{eyebrow}</p>
      {/if}
      <h1 class="text-text text-2xl font-semibold tracking-tight">
        {heading}
      </h1>
      {#if subheading}
        <p class="text-text-muted mt-2 text-sm leading-relaxed">
          {subheading}
        </p>
      {/if}
    </div>

    <div class="panel rounded-md p-6 sm:p-7">
      {@render children()}
    </div>

    {#if below}
      <div class="mt-4">
        {@render below()}
      </div>
    {/if}

    {#if footer}
      <div class="text-text-muted mt-6 text-center text-sm">
        {@render footer()}
      </div>
    {/if}
  </div>
</div>
