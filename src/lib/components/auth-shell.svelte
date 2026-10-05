<script lang="ts">
	import type { Snippet } from "svelte";
	import BrandLogo from "#lib/components/brand-logo.svelte";
	import PoweredBy from "#lib/components/powered-by.svelte";
	import { type AuthBranding, brandAccentStyle } from "#lib/error-pages.js";
	import ErrorBoundary from "./error-boundary.svelte";

	interface Props {
		below?: Snippet;
		branding?: AuthBranding | null;
		children: Snippet;
		eyebrow?: string;
		footer?: Snippet;
		heading: string;
		subheading?: string;
	}

	const {
		heading,
		subheading,
		eyebrow,
		children,
		below,
		footer,
		branding = null,
	}: Props = $props();
</script>

<div
  class="flex min-h-screen flex-col items-center justify-center px-6 py-12"
  style={brandAccentStyle(branding)}
>
  <div class="w-full max-w-md">
    <BrandLogo class="mb-8" {branding} size="lg" />

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
      <ErrorBoundary title="This page hit an error.">
        {@render children()}
      </ErrorBoundary>
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

    {#if branding?.poweredBy}
      <PoweredBy class="mt-6" />
    {/if}
  </div>
</div>
