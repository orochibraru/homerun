<script lang="ts">
	import { Download, FileCode2, FolderTree, Package } from "@lucide/svelte";
	import CodeBlock from "#lib/components/code-block.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { labelClass } from "#lib/components/form-styles.js";
	import IacScopePicker from "#lib/components/iac-scope-picker.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { PROVIDER_SOURCE } from "#lib/iac/generate.js";
	import { IAC_TOOL_INFO, usesHttpBackend } from "#lib/iac/tools.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let scope = $derived(data.scope || (data.project.scope ?? ""));
	let selectedPath = $state("");

	const tool = $derived(IAC_TOOL_INFO[data.project.tool]);
	const current = $derived(
		data.files?.find((file) => file.path === selectedPath) ??
			data.files?.find((file) => file.path.endsWith(".tf")) ??
			data.files?.[0] ??
			null,
	);
	const downloadHref = $derived(
		`${resolve("/(protected)/iac/[projectId]/download", {
			projectId: data.project.id,
		})}?${new URLSearchParams({ scope: data.scope })}`,
	);
</script>

<div class="space-y-5">
  {#if usesHttpBackend(data.project.tool)}
    <section class="panel rounded-md">
      <PanelHeader
        description={`${tool.label} files for one stack (its substacks included) or one service, with an import block for everything in it, so ${tool.cli} plan adopts what already runs. The backend block points at this project.`}
        icon={FileCode2}
        title="Generate the configuration"
      />
      <form class="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-end" method="GET">
        <div>
          <label class={labelClass} for="iac-generate-scope">Stack or service</label>
          <IacScopePicker
            id="iac-generate-scope"
            name="scope"
            scopes={data.scopes}
            bind:value={scope}
          />
        </div>
        <Button disabled={!scope} type="submit">Generate</Button>
      </form>
    </section>

    {#if data.files && current}
      <section class="panel rounded-md">
        <PanelHeader
          description={`${data.files.length} files for ${data.name}. Unzip, export an API key from the Credentials tab, then ${tool.cli} init and plan.`}
          icon={FolderTree}
          title="Files"
        >
          {#snippet trailing()}
            <Button download href={downloadHref} size="sm">
              <Download class="size-3.5" />
              Download .zip
            </Button>
          {/snippet}
        </PanelHeader>
        <div class="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
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
    {:else}
      <EmptyState
        icon={FolderTree}
        subtitle="Pick a stack or a service above, or set what this project manages under Settings."
        title="Nothing generated yet"
      />
    {/if}
  {/if}

  <section class="panel rounded-md">
    <PanelHeader
      description={usesHttpBackend(data.project.tool)
        ? `Source address ${PROVIDER_SOURCE}. Resources cover stacks, services and every setting they have, environments, dependencies, volumes and mounts, cron jobs, redirects, notification channels, backup destinations, status pages, DNS connections, git providers, build cache registries, object stores and buckets.`
        : `Pulumi runs the ${PROVIDER_SOURCE} Terraform provider. Homerun doesn't write Pulumi programs yet: start from the example below, and adopt what already runs with pulumi import.`}
      icon={Package}
      title="Provider"
    />
    <div class="divide-border divide-y">
      {#each data.snippets as snippet (snippet.id)}
        <div class="space-y-2 px-5 py-4">
          <h3 class="text-text text-sm font-medium">{snippet.title}</h3>
          <p class="text-text-muted text-xs">{snippet.description}</p>
          <CodeBlock code={snippet.code} html={snippet.html} label={snippet.title} />
        </div>
      {/each}
    </div>
  </section>
</div>
