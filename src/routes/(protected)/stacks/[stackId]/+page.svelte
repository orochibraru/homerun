<script lang="ts">
	import { LayoutGrid, Plus, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import EntityList from "$lib/components/entity-list.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { title } from "$lib/store/title";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();
	const stack = $derived(data.stack);

	onMount(() => title.set(stack.name));

	const view = new ViewMode("stack-services");
	let search = $state("");

	const filtered = $derived(
		data.services.filter((svc) =>
			`${svc.name} ${svc.slug} ${svc.image}:${svc.tag}`
				.toLowerCase()
				.includes(search.trim().toLowerCase()),
		),
	);
</script>

{#if data.services.length === 0}
  <div class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
    <Server class="text-text-subtle mb-3 size-8" />
    <p class="text-text-muted text-sm font-medium">
      No services in this stack yet
    </p>
    <div class="mt-5 flex gap-2">
      <Button href="{resolve('/templates')}?stackId={stack.id}" variant="outline">
        <LayoutGrid class="size-4" />
        From Template
      </Button>
      <Button href="{resolve('/services/new')}?stackId={stack.id}">
        <Plus class="size-4" />
        Add Service
      </Button>
    </div>
  </div>
{:else}
  <div class="mb-3 flex flex-wrap items-center gap-2">
    <Input
      class="max-w-xs"
      placeholder="Search services…"
      type="search"
      bind:value={search}
    />
    <div class="ml-auto">
      <ViewModeToggle {view} />
    </div>
  </div>

  {#if filtered.length === 0}
    <div class="border-border/70 rounded-xl border border-dashed py-12 text-center">
      <p class="text-text-muted text-sm">No services match your search.</p>
    </div>
  {:else}
    <EntityList
      {badge}
      items={filtered.map((svc) => ({
        description: `${svc.image}:${svc.tag}`,
        href: `${resolve("/services")}/${svc.id}`,
        id: svc.id,
        subtitle: `${stack.slug}-${svc.slug}`,
        title: svc.name,
      }))}
      {media}
      {view}
    />
  {/if}
{/if}

{#snippet media(_item: { id: string })}
  <span class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
    <Server class="size-4" />
  </span>
{/snippet}

{#snippet badge(item: { id: string })}
  {@const svc = data.services.find((s) => s.id === item.id)}
  {#if svc}
    <StatusBadge status={svc.currentStatus} />
  {/if}
{/snippet}
