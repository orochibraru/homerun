<script lang="ts">
	import { ChevronRight, FileCode2, Lock, Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityList from "#lib/components/entity-list.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import ViewModeToggle from "#lib/components/view-mode-toggle.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { IAC_TOOL_INFO, usesHttpBackend } from "#lib/iac/tools.js";
	import { title } from "#lib/store/title.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set("Infrastructure as Code"));

	const view = new ViewMode("iac-projects");

	const rows = $derived(
		data.projects.map((project) => ({
			href: resolve("/(protected)/iac/[projectId]", { projectId: project.id }),
			id: project.id,
			locked: project.locked,
			subtitle: [
				project.scopeLabel ? `manages ${project.scopeLabel}` : null,
				`${project.bucket}${project.prefix ? `/${project.prefix}` : ""}${project.storeName ? ` on ${project.storeName}` : ""}`,
				usesHttpBackend(project.tool)
					? project.updatedAt
						? `serial ${project.serial} written ${timeAgo(project.updatedAt)}`
						: "no state yet"
					: null,
			]
				.filter(Boolean)
				.join(" · "),
			title: project.name,
			tool: IAC_TOOL_INFO[project.tool].label,
		})),
	);
	type ProjectRow = (typeof rows)[number];
</script>

{#snippet media(_item: ProjectRow)}
  <div class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md">
    <FileCode2 class="size-5" />
  </div>
{/snippet}

{#snippet badge(item: ProjectRow)}
  <span class="bg-surface-2 text-text-muted shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold">
    {item.tool}
  </span>
  {#if item.locked}
    <Lock aria-label="Locked" class="size-3.5 shrink-0 text-amber-500" />
  {/if}
{/snippet}

{#snippet actions(item: ProjectRow)}
  <Button href={item.href} size="icon-sm" title="Open" variant="ghost">
    <ChevronRight class="size-4" />
  </Button>
{/snippet}

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">Infrastructure as Code</h1>
      <p class="text-text-muted mt-1 text-sm">
        Manage this instance with Terraform, OpenTofu or Pulumi. Each project
        keeps its state here, generates its configuration from what's running
        and shows where the two disagree.
      </p>
    </div>

    {#if data.hasStore}
      <Button href={resolve("iac/new")}><Plus class="size-4" />New project</Button>
    {/if}
  </div>

  {#if data.projects.length === 0}
    {#if data.hasStore}
      <EmptyState
        icon={FileCode2}
        subtitle="A project picks a tool, keeps its state in a bucket and covers a stack or a service."
        title="No IaC project yet"
      ><Button href={resolve("iac/new")}><Plus class="size-4" />Create your first project</Button></EmptyState>
    {:else}
      <EmptyState
        icon={FileCode2}
        subtitle="A project keeps its state in a bucket: turn on the built-in object store or connect one first."
        title="No object store yet"
      ><Button href={resolve("object-storage/built-in")}>Set up object storage</Button></EmptyState>
    {/if}
  {:else}
    <div class="mb-4 flex justify-end">
      <ViewModeToggle {view} />
    </div>
    <EntityList {actions} {badge} items={rows} {media} {view} />
  {/if}
</div>
