<script lang="ts">
	import { FolderKanban, Plus, Server } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import { Button } from "$lib/components/ui/button";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Projects"));
</script>

<div class="p-6 md:p-8">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Projects</h1>
      <p class="mt-1 text-sm text-text-muted">
        Group related services together.
      </p>
    </div>
    <Button href={resolve("/projects/new")} size="sm">
      <Plus class="size-4" />
      New Project
    </Button>
  </div>

  {#if data.projects.length === 0}
    <div class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-20 text-center">
      <FolderKanban class="mb-3 size-10 text-text-muted opacity-40" />
      <p class="text-sm font-medium text-text-muted">No projects yet</p>
      <p class="mt-1 text-xs text-text-subtle mb-3">
        Create one to group related services together.
      </p>
      <Button href={resolve("/projects/new")}>
        <Plus class="size-4" />
        New Project
      </Button>
    </div>
  {:else}
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {#each data.projects as proj (proj.id)}
        <a
          class="rounded-2xl glass p-5 transition-shadow hover:shadow-md"
          href="{resolve('/projects')}/{proj.id}"
        >
          <div class="bg-accent/10 text-accent mb-3 flex size-10 items-center justify-center rounded-xl">
            <FolderKanban class="size-5" />
          </div>
          <p class="truncate font-semibold text-text">
            {proj.name}
          </p>
          {#if proj.description}
            <p class="mt-0.5 line-clamp-2 text-xs text-text-muted">
              {proj.description}
            </p>
          {/if}
          <div class="mt-3 flex items-center gap-1.5 text-xs text-text-subtle">
            <Server class="size-3.5" />
            {proj.serviceCount}
            {proj.serviceCount === 1 ? "service" : "services"}
          </div>
        </a>
      {/each}
    </div>
  {/if}
</div>
