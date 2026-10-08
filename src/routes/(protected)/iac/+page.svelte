<script lang="ts">
	import {
		ArrowRight,
		Check,
		ChevronRight,
		Database,
		FileCode2,
		GitCompareArrows,
		KeyRound,
		ListChecks,
		Lock,
		Package,
		Plus,
	} from "@lucide/svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { timeAgo } from "#lib/formatting.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	const lockedCount = $derived(
		data.projects.filter((project) => project.locked).length,
	);
	const lastWrite = $derived(
		data.projects
			.map((project) => project.updatedAt)
			.filter((date) => date !== null)
			.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null,
	);
	const statCards = $derived([
		{
			dot: "bg-accent",
			label: "State backends",
			value: String(data.projects.length),
		},
		{
			dot: lockedCount > 0 ? "bg-amber-500" : "bg-text-subtle",
			label: "Locked",
			value: String(lockedCount),
		},
		{
			dot: "bg-text-subtle",
			label: "Last write",
			value: lastWrite ? timeAgo(lastWrite) : "Never",
		},
	]);
	const steps = $derived([
		{
			description:
				"The state lives in a bucket: turn on the built-in store or connect a provider.",
			done: data.stores.length > 0,
			href: resolve("/(protected)/object-storage/built-in"),
			label: "An object store",
		},
		{
			description:
				"A bucket Homerun versions and locks every Terraform state in.",
			done: data.projects.length > 0,
			href: resolve("/(protected)/iac/state/new"),
			label: "A state backend",
		},
		{
			description:
				"The provider and the state backend both authenticate with one.",
			done: data.apiKeyCount > 0,
			href: resolve("/(protected)/iac/credentials/new"),
			label: "An API key",
		},
		{
			description:
				"Generate a project for a stack or a service, then terraform init and apply.",
			done: data.projects.some((project) => project.serial !== null),
			href: resolve("/(protected)/iac/generate"),
			label: "A first apply",
		},
	]);
	const shortcuts = [
		{
			description:
				"Terraform files for a stack or a service, imports included.",
			href: resolve("/(protected)/iac/generate"),
			icon: FileCode2,
			label: "Generate",
		},
		{
			description: "Backends, versions, rollbacks, locks and bucket keys.",
			href: resolve("/(protected)/iac/state"),
			icon: Database,
			label: "State",
		},
		{
			description: "API keys for the provider and the state backend.",
			href: resolve("/(protected)/iac/credentials"),
			icon: KeyRound,
			label: "Credentials",
		},
		{
			description: "Where a state and what's running disagree.",
			href: resolve("/(protected)/iac/drift"),
			icon: GitCompareArrows,
			label: "Drift",
		},
		{
			description: "The provider's source and configuration snippets.",
			href: resolve("/(protected)/iac/provider"),
			icon: Package,
			label: "Provider",
		},
	];
</script>

<div class="space-y-5">
  <div class="panel divide-border flex divide-x rounded-md">
    {#each statCards as card (card.label)}
      <div class="min-w-0 flex-1 px-4 py-3">
        <p class="eyebrow flex items-center gap-1.5">
          <span class="size-1.5 rounded-full {card.dot}"></span>
          {card.label}
        </p>
        <p class="metric mt-2">{card.value}</p>
      </div>
    {/each}
  </div>

  {#if steps.some((step) => !step.done)}
    <section class="panel rounded-md">
      <PanelHeader
        description="What Terraform needs to manage this instance."
        icon={ListChecks}
        title="Getting started"
      />
      <ol class="divide-border divide-y">
        {#each steps as step, index (step.label)}
          <li>
            <a class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3" href={step.href}>
              <span
                class="flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-medium {step.done ? 'bg-primary text-primary-foreground' : 'border-border text-text-muted border'}"
              >
                {#if step.done}
                  <Check class="size-3.5" />
                {:else}
                  {index + 1}
                {/if}
              </span>
              <span class="min-w-0 flex-1">
                <span class="text-text block text-sm font-medium {step.done ? 'line-through opacity-60' : ''}">{step.label}</span>
                <span class="text-text-muted block text-xs">{step.description}</span>
              </span>
              <ArrowRight class="text-text-subtle size-4 shrink-0" />
            </a>
          </li>
        {/each}
      </ol>
    </section>
  {/if}

  <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
    {#each shortcuts as shortcut (shortcut.label)}
      <a class="panel hover:bg-surface-2 flex items-start gap-3 rounded-md p-4" href={shortcut.href}>
        <shortcut.icon class="text-accent mt-0.5 size-4 shrink-0" />
        <span class="min-w-0">
          <span class="text-text block text-sm font-medium">{shortcut.label}</span>
          <span class="text-text-muted block text-xs">{shortcut.description}</span>
        </span>
      </a>
    {/each}
  </div>

  <section class="panel rounded-md">
    <PanelHeader
      description="Every Terraform state kept on this instance."
      icon={Database}
      title="State backends"
    >
      {#snippet trailing()}
        <Button href={resolve("/(protected)/iac/state/new")} size="sm" variant="outline">
          <Plus class="size-3.5" />
          New backend
        </Button>
      {/snippet}
    </PanelHeader>
    {#if data.projects.length > 0}
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Backend</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Bucket</th>
              <th class="px-4 py-3 font-medium">Serial</th>
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
                <td class="text-text-muted hidden px-4 py-3 md:table-cell">
                  <span class="font-mono text-xs">{project.bucket}</span>
                  {#if project.storeName}
                    <span class="text-text-subtle text-xs">on {project.storeName}</span>
                  {/if}
                </td>
                <td class="text-text-muted px-4 py-3 tabular-nums">{project.serial ?? "—"}</td>
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
        subtitle="A state backend keeps each Terraform state in a bucket, versioned and locked by Homerun."
        title="No state backend yet"
      />
    {/if}
  </section>
</div>
