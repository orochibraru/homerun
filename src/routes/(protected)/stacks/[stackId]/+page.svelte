<script lang="ts">
	import {
		ArrowLeft,
		Clock,
		LayoutGrid,
		Plus,
		Server,
		Settings as SettingsIcon,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import EntityList from "$lib/components/entity-list.svelte";
	import ServiceUsageTable from "$lib/components/service-usage-table.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { timeAgo } from "$lib/formatting";
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

	const running = $derived(
		data.services.filter((svc) => svc.currentStatus === "running").length,
	);

	const serviceIds = $derived(data.services.map((svc) => svc.id));
</script>

<div class="p-5 md:p-6">
  <a
    class="text-text-muted hover:text-text mb-4 inline-flex items-center gap-1.5 text-sm"
    href={resolve("/stacks")}
  >
    <ArrowLeft class="size-3.5" />
    Stacks
  </a>

  <div class="border-border mb-5 flex flex-wrap items-end justify-between gap-3 border-b pb-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">{stack.name}</h1>
      <p class="text-text-muted mt-0.5 text-xs">
        {stack.description ?? `Services on the ${stack.slug} network.`}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <Button
        href={resolve("/(protected)/stacks/[stackId]/settings", {
          stackId: stack.id,
        })}
        size="sm"
        variant="outline"
      >
        <SettingsIcon class="size-3.5" />
        Settings
      </Button>
      <Button
        href="{resolve('/templates')}?stackId={stack.id}"
        size="sm"
        variant="outline"
      >
        <LayoutGrid class="size-3.5" />
        From Template
      </Button>
      <Button href="{resolve('/services/new')}?stackId={stack.id}" size="sm">
        <Plus class="size-4" />
        Add Service
      </Button>
    </div>
  </div>

  {#if data.services.length === 0}
    <div class="border-border flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
      <Server class="text-text-subtle mb-3 size-8" />
      <p class="text-text-muted text-sm font-medium">
        No services in this stack yet
      </p>
      <div class="mt-5 flex gap-2">
        <Button
          href="{resolve('/templates')}?stackId={stack.id}"
          variant="outline"
        >
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
    <div class="mb-4 grid items-start gap-4 lg:grid-cols-[minmax(0,17rem)_minmax(0,1fr)]">
      <div class="panel divide-border flex divide-x rounded-xl">
        <div class="min-w-0 flex-1 px-4 py-3">
          <p class="eyebrow flex items-center gap-1.5">
            <span class="bg-accent size-1.5 rounded-full"></span>
            Services
          </p>
          <p class="metric mt-2">{data.services.length}</p>
        </div>
        <div class="min-w-0 flex-1 px-4 py-3">
          <p class="eyebrow flex items-center gap-1.5">
            <span class="size-1.5 rounded-full bg-emerald-500"></span>
            Running
          </p>
          <p class="metric mt-2">{running}</p>
        </div>
      </div>

      <ServiceUsageTable {serviceIds} title="Resource usage" />
    </div>

    <div class="mb-4 panel rounded-xl">
      <div class="panel-head">
        <h2 class="eyebrow flex items-center gap-1.5">
          <Clock class="size-3" />
          Recent deployments
        </h2>
      </div>
      {#if data.recentDeployments.length === 0}
        <p class="text-text-muted px-4 py-6 text-center text-xs">
          Nothing deployed in this stack yet.
        </p>
      {:else}
        <div class="divide-border divide-y">
          {#each data.recentDeployments as dep (dep.id)}
            <a
              class="hover:bg-surface-2 flex items-center gap-3 px-4 py-2.5 transition-colors"
              href="{resolve('/services')}/{dep.serviceId}"
            >
              <StatusBadge status={dep.status} />
              <span class="text-text min-w-0 flex-1 truncate text-sm">
                {dep.serviceName ?? "Unknown service"}
              </span>
              <span class="tabular-nums text-text-subtle shrink-0 text-[0.6875rem]">
                {timeAgo(dep.createdAt)}
              </span>
            </a>
          {/each}
        </div>
      {/if}
    </div>

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
</div>

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
