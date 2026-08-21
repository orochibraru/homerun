<script lang="ts">
	import { LayoutGrid, Plus, Rocket } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button";
	import { templateIcon } from "$lib/constants";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Templates"));
</script>

{#snippet card(tmpl: (typeof data.builtins)[number])}
  {@const Icon = templateIcon(tmpl.icon)}
  <div class="rounded-2xl border flex flex-col justify-between gap-2 h-full border-border bg-surface p-5 transition-shadow hover:shadow-md">
    <div class="bg-accent/10 text-accent flex size-10 items-center justify-center rounded-xl">
      <Icon class="size-5" />
    </div>
    <p class="font-semibold text-text">{tmpl.name}</p>
    {#if tmpl.description}
      <p class="line-clamp-2 text-xs text-text-muted">
        {tmpl.description}
      </p>
    {/if}
    <p class="font-mono text-xs text-text-subtle">{tmpl.image}:{tmpl.tag}</p>
    <Button
      class="w-full"
      href="{resolve('/services/new')}?templateId={tmpl.id}{data.project
        ? `&projectId=${data.project.id}`
        : ''}"
      size="sm"
    >
      <Rocket class="size-3.5" />
      Deploy
    </Button>
  </div>
{/snippet}

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-2xl font-bold text-text">Templates</h1>
      <p class="mt-1 text-sm text-text-muted">
        One-click configs for common services.
      </p>
    </div>
    <Button href={resolve("/templates/new")} size="sm">
      <Plus class="size-4" />
      New Template
    </Button>
  </div>

  <div class="mb-8">
    <h2 class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase">
      Built-in
    </h2>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {#each data.builtins as tmpl (tmpl.id)}
        {@render card(tmpl)}
      {/each}
    </div>
  </div>

  <div>
    <h2 class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase">
      My Templates
    </h2>
    {#if data.mine.length === 0}
      <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-12 text-center">
        <LayoutGrid class="mb-3 size-8 text-text-muted opacity-40" />
        <p class="text-sm font-medium text-text-muted">
          No custom templates yet
        </p>
        <p class="mt-1 text-xs text-text-subtle">
          Build one from scratch, or save an existing service as a template from
          its Settings tab.
        </p>
      </div>
    {:else}
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {#each data.mine as tmpl (tmpl.id)}
          {@render card(tmpl)}
        {/each}
      </div>
    {/if}
  </div>
</div>
