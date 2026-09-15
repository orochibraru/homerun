<script lang="ts">
	import { Container, Globe, ShieldCheck } from "@lucide/svelte";
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

	const HIGHLIGHTS = [
		{
			icon: Container,
			label: "Deploy",
			text: "Point at an image or a git repo, fill one form, it runs.",
		},
		{
			icon: Globe,
			label: "Route",
			text: "Traefik maps every service to its own subdomain, with TLS.",
		},
		{
			icon: ShieldCheck,
			label: "Own it",
			text: "One host, your Docker socket, no registry in the middle.",
		},
	];
</script>

<div class="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
  <aside
    class="bg-surface relative hidden flex-col justify-between overflow-hidden border-r border-border px-10 py-12 lg:flex xl:px-16"
  >
    <span class="bg-accent absolute inset-y-0 left-0 w-1"></span>

    <BrandMark class="relative" size="lg" />

    <div class="relative max-w-lg">
      <h2
        class="text-text text-3xl leading-[1.15] font-semibold tracking-tight xl:text-4xl"
      >
        Your own metal.
        <span class="text-accent block">One form to production.</span>
      </h2>
      <p class="text-text-muted mt-4 text-sm leading-relaxed">
        A single-host PaaS for the containers you already have. No cluster, no
        control plane, no seat count.
      </p>

      <ul class="mt-9 space-y-5">
        {#each HIGHLIGHTS as item (item.label)}
          {@const Icon = item.icon}
          <li class="flex items-start gap-3.5">
            <span
              class="bg-accent-light text-accent flex size-9 shrink-0 items-center justify-center rounded-xl"
            >
              <Icon class="size-4.5" />
            </span>
            <div class="min-w-0">
              <p class="eyebrow">{item.label}</p>
              <p class="text-text mt-1 text-sm">{item.text}</p>
            </div>
          </li>
        {/each}
      </ul>
    </div>

    <div class="panel relative max-w-md rounded-2xl p-4">
      <div class="flex items-center gap-1.5 border-b border-border pb-3">
        <span class="size-2 rounded-full bg-red-400/60"></span>
        <span class="size-2 rounded-full bg-amber-400/60"></span>
        <span class="size-2 rounded-full bg-emerald-400/60"></span>
        <span class="eyebrow ml-2">deploy</span>
      </div>
      <div class="mt-3 space-y-1.5 font-mono text-xs">
        <p class="text-text">
          <span class="text-accent">$</span> homerun deploy ghcr.io/you/api
        </p>
        <p class="text-text-subtle">pulling image ghcr.io/you/api:latest</p>
        <p class="text-text-subtle">routing api.your-domain.dev · tls ok</p>
        <p class="text-emerald-500">
          live in 6.2s
          <span
            class="bg-accent ml-0.5 inline-block h-3 w-1.5 translate-y-0.5 animate-pulse"
          ></span>
        </p>
      </div>
    </div>
  </aside>

  <div class="flex flex-col items-center justify-center px-6 py-12 sm:px-10">
    <div class="w-full max-w-md">
      <BrandMark class="mb-8 lg:hidden" size="lg" />

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

      <div class="panel rounded-2xl p-6 sm:p-7">
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
</div>
