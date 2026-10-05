<script lang="ts">
	import { Download, FileCode2, FolderTree } from "@lucide/svelte";
	import CodeBlock from "#lib/components/code-block.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let scope = $derived(data.scope);
	let projectId = $derived(data.projectId);
	let selectedPath = $state("");

	const scopeLabel = $derived(
		data.scopes.find((option) => option.value === scope)?.label ??
			"Pick a stack or a service",
	);
	const projectLabel = $derived(
		data.projects.find((project) => project.id === projectId)?.name ??
			"No backend",
	);
	const groups = $derived(
		["Stacks", "Services"]
			.map((group) => ({
				group,
				options: data.scopes.filter((option) => option.group === group),
			}))
			.filter((entry) => entry.options.length > 0),
	);
	const current = $derived(
		data.files?.find((file) => file.path === selectedPath) ??
			data.files?.find((file) => file.path.endsWith(".tf")) ??
			data.files?.[0] ??
			null,
	);
	const downloadHref = $derived(
		`${resolve("/(protected)/iac/download")}?${new URLSearchParams({
			...(projectId ? { project: projectId } : {}),
			scope: data.scope,
		})}`,
	);
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description="A Terraform project for one stack (its substacks included) or one service, with an import block for everything in it, so terraform plan adopts what already runs."
      icon={FileCode2}
      title="Generate a project"
    />
    <form class="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" method="GET">
      <div>
        <label class={labelClass} for="iac-scope">Stack or service</label>
        <Select.Root name="scope" type="single" bind:value={scope}>
          <Select.Trigger id="iac-scope" class="w-full">{scopeLabel}</Select.Trigger>
          <Select.Content>
            {#each groups as entry (entry.group)}
              <Select.Group>
                <Select.Label>{entry.group}</Select.Label>
                {#each entry.options as option (option.value)}
                  <Select.Item label={option.label} value={option.value} />
                {/each}
              </Select.Group>
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <div>
        <label class={labelClass} for="iac-project">State backend</label>
        <Select.Root name="project" type="single" bind:value={projectId}>
          <Select.Trigger id="iac-project" class="w-full">{projectLabel}</Select.Trigger>
          <Select.Content>
            <Select.Item label="No backend" value="" />
            {#each data.projects as project (project.id)}
              <Select.Item label={project.name} value={project.id} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <Button disabled={!scope} type="submit">Generate</Button>
    </form>
    {#if data.projects.length === 0}
      <p class="text-text-muted border-border border-t px-5 py-3 text-xs">
        No Terraform state project yet:
        <a class="text-accent hover:underline" href={resolve("/(protected)/object-storage/state")}>create one in Object Storage</a>
        to keep the state on this instance.
      </p>
    {/if}
  </section>

  {#if data.files && current}
    <section class="panel rounded-md">
      <PanelHeader
        description={`${data.files.length} files for ${data.name}. Unzip, set HOMERUN_API_KEY, then terraform init and plan.`}
        icon={FolderTree}
        title="Project"
      >
        {#snippet trailing()}
          <Button download href={downloadHref} size="sm">
            <Download class="size-3.5" />
            Download .zip
          </Button>
        {/snippet}
      </PanelHeader>
      <div class="grid gap-4 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <ul class="flex flex-row flex-wrap gap-1 md:flex-col" aria-label="Files">
          {#each data.files as file (file.path)}
            <li>
              <button
                class="hover:bg-surface-2 w-full rounded-md px-2.5 py-1.5 text-left font-mono text-xs {file.path === current.path ? 'bg-surface-2 text-text font-bold' : 'text-text-muted'}"
                aria-current={file.path === current.path ? "true" : undefined}
                onclick={() => {
                  selectedPath = file.path;
                }}
                type="button"
              >
                {file.path}
              </button>
            </li>
          {/each}
        </ul>
        <CodeBlock code={current.content} html={current.html} label={current.path} />
      </div>
    </section>
  {:else if !data.scope}
    <EmptyState
      icon={FolderTree}
      subtitle="Pick a stack or a service above to generate its Terraform project."
      title="Nothing generated yet"
    />
  {/if}
</div>
