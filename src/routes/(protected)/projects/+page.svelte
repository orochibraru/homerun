<script lang="ts">
	import { FolderKanban, Plus, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityListView from "$lib/components/entity-list-view.svelte";
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

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Projects</h1>
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
      <div class="border-border/70 rounded-2xl border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No projects match your search.</p>
      </div>
    {:else}
      {#snippet row(proj: Project)}
        <a
          class="glass flex items-center gap-4 rounded-2xl p-5 transition-shadow hover:shadow-md"
          href="{resolve('/projects')}/{proj.id}"
        >
          <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-xl">
            <FolderKanban class="size-5" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-text truncate text-sm font-semibold">{proj.name}</p>
            {#if proj.description}
              <p class="text-text-muted mt-0.5 truncate text-xs">
                {proj.description}
              </p>
            {/if}
          </div>
          <span class="text-text-subtle flex shrink-0 items-center gap-1.5 font-mono text-xs">
            <Server class="size-3.5" />
            {proj.serviceCount}
            {serviceLabel(proj.serviceCount)}
          </span>
        </a>
      {/snippet}

      {#snippet card(proj: Project)}
        <a
          class="glass glass-interactive block rounded-2xl p-5"
          href="{resolve('/projects')}/{proj.id}"
        >
          <div class="bg-accent/10 text-accent mb-3 flex size-10 items-center justify-center rounded-xl">
            <FolderKanban class="size-5" />
          </div>
          <p class="text-text truncate font-semibold">
            {proj.name}
          </p>
          {#if proj.description}
            <p class="text-text-muted mt-0.5 line-clamp-2 text-xs">
              {proj.description}
            </p>
          {/if}
          <div class="text-text-subtle mt-3 flex items-center gap-1.5 text-xs">
            <Server class="size-3.5" />
            {proj.serviceCount}
            {serviceLabel(proj.serviceCount)}
          </div>
        </a>
      {/snippet}

      <EntityListView
        {card}
        getKey={(proj) => proj.id}
        items={data.projects}
        {row}
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
