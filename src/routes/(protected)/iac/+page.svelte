<script lang="ts">
	import { Download, FileCode2 } from "@lucide/svelte";
	import CodeEditor from "#lib/components/code-editor.svelte";
	import CopyButton from "#lib/components/copy-button.svelte";
	import { labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let stackId = $derived(data.stackId);
	let projectId = $derived(data.projectId);

	const stackLabel = $derived(
		data.stacks.find((stack) => stack.id === stackId)?.path ?? "Everything",
	);
	const projectLabel = $derived(
		data.projects.find((project) => project.id === projectId)?.name ??
			"No backend",
	);
	const download = $derived(
		`data:text/plain;charset=utf-8,${encodeURIComponent(data.configuration)}`,
	);
	const total = $derived(
		data.counts.reduce((sum, entry) => sum + entry.count, 0),
	);
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description="Pick what to include and where Terraform keeps its state, then generate."
      icon={FileCode2}
      title="Starter configuration"
    />
    <form class="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end" method="GET">
      <div>
        <label class={labelClass} for="iac-stack">Include</label>
        <Select.Root name="stack" type="single" bind:value={stackId}>
          <Select.Trigger id="iac-stack" class="w-full">{stackLabel}</Select.Trigger>
          <Select.Content>
            <Select.Item label="Everything" value="" />
            {#each data.stacks as stack (stack.id)}
              <Select.Item label={stack.path} value={stack.id} />
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
      <Button type="submit">Generate</Button>
    </form>
    {#if data.projects.length === 0}
      <p class="text-text-muted border-border border-t px-5 py-3 text-xs">
        No Terraform state project yet:
        <a class="text-accent hover:underline" href={resolve("/(protected)/object-storage/state")}>create one in Object Storage</a>
        to keep the state on this instance.
      </p>
    {/if}
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description={total === 0
        ? "Nothing to manage yet."
        : `${total} ${total === 1 ? "object" : "objects"}, each with an import block so terraform plan adopts it instead of creating it.`}
      title="main.tf"
    >
      {#snippet trailing()}
        <CopyButton label="main.tf" text="Copy" value={data.configuration} />
        <Button download="main.tf" href={download} size="sm" variant="outline">
          <Download class="size-3.5" />
          Download
        </Button>
      {/snippet}
    </PanelHeader>
    {#if data.counts.length > 0}
      <ul class="text-text-muted border-border flex flex-wrap gap-x-4 gap-y-1 border-b px-5 py-3 font-mono text-xs">
        {#each data.counts as entry (entry.type)}
          <li>{entry.type} <span class="text-text tabular-nums">{entry.count}</span></li>
        {/each}
      </ul>
    {/if}
    <div class="p-3">
      <CodeEditor aria-label="Generated configuration" language={null} readonly value={data.configuration} />
    </div>
  </section>
</div>
