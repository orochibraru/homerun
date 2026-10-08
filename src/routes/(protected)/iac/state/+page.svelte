<script lang="ts">
	import { ChevronRight, Database, Lock, Plus } from "@lucide/svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { timeAgo } from "#lib/formatting.js";
	import { resolve } from "$app/paths";

	const { data } = $props();
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Each one keeps a Terraform state in a bucket, versioned and locked by Homerun."
    icon={Database}
    title="State backends"
  >
    {#snippet trailing()}
      <Button href={resolve("/(protected)/iac/state/new")} size="sm">
        <Plus class="size-4" />
        New state backend
      </Button>
    {/snippet}
  </PanelHeader>
  {#if data.projects.length > 0}
    <div class="overflow-x-auto">
      <table class="w-full text-sm">
        <thead>
          <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
            <th class="px-4 py-3 font-medium">Backend</th>
            <th class="px-4 py-3 font-medium">Serial</th>
            <th class="hidden px-4 py-3 font-medium md:table-cell">Bucket</th>
            <th class="hidden px-4 py-3 font-medium md:table-cell">Last written</th>
            <th class="w-8 px-4 py-3"><span class="sr-only">Open</span></th>
          </tr>
        </thead>
        <tbody>
          {#each data.projects as project (project.id)}
            <tr class="border-border/60 hover:bg-surface-2 group relative border-b last:border-0">
              <td class="px-4 py-3">
                <span class="inline-flex items-center gap-1.5">
                  <a
                    class="text-text group-hover:text-accent font-medium after:absolute after:inset-0"
                    href={resolve("/(protected)/iac/state/[projectId]", {
                      projectId: project.id,
                    })}
                  >
                    {project.name}
                  </a>
                  {#if project.locked}
                    <Lock aria-label="Locked" class="size-3.5 text-amber-500" />
                  {/if}
                </span>
              </td>
              <td class="text-text-muted px-4 py-3 tabular-nums">{project.serial ?? "—"}</td>
              <td class="text-text-muted hidden px-4 py-3 md:table-cell">
                <span class="font-mono text-xs">{project.bucket}</span>
                {#if project.storeName}
                  <span class="text-text-subtle text-xs">on {project.storeName}</span>
                {/if}
              </td>
              <td class="text-text-muted hidden px-4 py-3 md:table-cell">
                {project.updatedAt ? timeAgo(project.updatedAt) : "Never"}
              </td>
              <td class="text-text-subtle px-4 py-3"><ChevronRight class="size-4" /></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <EmptyState
      icon={Database}
      subtitle="Create one to keep a Terraform state on this instance."
      title="No state backend yet"
    />
  {/if}
</section>
