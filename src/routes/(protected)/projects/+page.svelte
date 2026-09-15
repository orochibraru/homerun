<script lang="ts">
	import { FolderKanban, Plus, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import { Button } from "$lib/components/ui/button";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { title } from "$lib/store/title";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	type Project = (typeof data.projects)[number];

	onMount(() => title.set("Projects"));

	const view = new ViewMode("projects", "card");

	function serviceLabel(count: number): string {
		return count === 1 ? "service" : "services";
	}
</script>

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Projects</h1>
      <p class="text-text-muted mt-1 text-sm">
        Group related services together.
      </p>
    </div>
    <Button href={resolve("/projects/new")} size="sm">
      <Plus class="size-4" />
      New Project
    </Button>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={FolderKanban}
      subtitle="Create one to group related services together."
      title="No projects yet"
    >
      <Button href={resolve("/projects/new")}>
        <Plus class="size-4" />
        New Project
      </Button>
    </EmptyState>
  {:else}
    <EntityToolbar placeholder="Search projects by name…">
      {#snippet trailing()}
        <ViewModeToggle {view} />
      {/snippet}
    </EntityToolbar>

    {#if data.projects.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No projects match your search.</p>
      </div>
    {:else}
      {#snippet media(_item: { id: string })}
        <span class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
          <FolderKanban class="size-4" />
        </span>
      {/snippet}

      {#snippet meta(item: { id: string })}
        {@const proj = data.projects.find((p) => p.id === item.id)}
        {#if proj}
          <span class="text-text-subtle flex shrink-0 items-center gap-1.5 text-xs">
            <Server class="size-3.5" />
            {proj.serviceCount}
            {serviceLabel(proj.serviceCount)}
          </span>
        {/if}
      {/snippet}

      <EntityList
        items={data.projects.map((proj) => ({
          description: proj.description,
          href: `${resolve("/projects")}/${proj.id}`,
          id: proj.id,
          title: proj.name,
        }))}
        {media}
        {meta}
        {view}
      />

      <Pagination
        label="projects"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}
  {/if}
</div>
