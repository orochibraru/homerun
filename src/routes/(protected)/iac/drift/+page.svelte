<script lang="ts">
	import {
		CircleCheck,
		GitCompareArrows,
		PackagePlus,
		SearchX,
	} from "@lucide/svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import { formatDriftValue } from "#lib/iac/drift.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	let projectId = $derived(data.projectId);
	const projectLabel = $derived(
		data.projects.find((project) => project.id === projectId)?.name ??
			"Pick a state project",
	);
</script>

<div class="space-y-5">
  {#if data.projects.length === 0}
    <EmptyState
      icon={GitCompareArrows}
      subtitle="Drift compares a Terraform state kept on this instance with what's running."
      title="No Terraform state project yet"
    >
      <Button href={resolve("/(protected)/iac/state")} size="sm">Create one</Button>
    </EmptyState>
  {:else}
    <section class="panel rounded-md">
      <form class="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_auto] sm:items-end" method="GET">
        <div>
          <label class={labelClass} for="drift-project">State project</label>
          <Select.Root name="project" type="single" bind:value={projectId}>
            <Select.Trigger id="drift-project" class="w-full">{projectLabel}</Select.Trigger>
            <Select.Content>
              {#each data.projects as project (project.id)}
                <Select.Item label={project.name} value={project.id} />
              {/each}
            </Select.Content>
          </Select.Root>
        </div>
        <Button type="submit">Compare</Button>
      </form>
      {#if data.problem}
        <p class="text-text-muted border-border border-t px-5 py-3 text-sm">{data.problem}</p>
      {/if}
    </section>

    {#if data.report}
      {@const report = data.report}
      <p class="text-text-muted text-sm">
        {report.inSync} in sync · {report.drifted.length} drifted ·
        {report.missing.length} missing · {report.unmanaged.length} unmanaged
      </p>

      <section class="panel rounded-md">
        <PanelHeader
          description="Changed outside Terraform since the last apply. terraform plan puts them back unless the configuration changes too."
          icon={GitCompareArrows}
          title="Drifted"
        />
        {#if report.drifted.length === 0}
          <p class="text-text-muted flex items-center gap-2 px-5 py-4 text-sm">
            <CircleCheck class="size-4 text-emerald-500" />
            Every managed object matches the state.
          </p>
        {:else}
          <div class="overflow-x-auto">
            <table class="w-full text-sm">
              <thead>
                <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
                  <th class="px-4 py-3 font-medium">Resource</th>
                  <th class="px-4 py-3 font-medium">Attribute</th>
                  <th class="px-4 py-3 font-medium">State</th>
                  <th class="px-4 py-3 font-medium">Live</th>
                </tr>
              </thead>
              <tbody>
                {#each report.drifted as resource (resource.address)}
                  {#each resource.changes as change, index (change.attribute)}
                    <tr class="border-border/60 border-b last:border-0">
                      <td class="text-text px-4 py-2 font-mono text-xs">{index === 0 ? resource.address : ""}</td>
                      <td class="text-text-muted px-4 py-2 font-mono text-xs">{change.attribute}</td>
                      {#if change.sensitive}
                        <td class="text-text-subtle px-4 py-2 text-xs" colspan="2">Sensitive value changed</td>
                      {:else}
                        <td class="text-text-muted px-4 py-2 font-mono text-xs break-all">{formatDriftValue(change.state)}</td>
                        <td class="text-text px-4 py-2 font-mono text-xs break-all">{formatDriftValue(change.live)}</td>
                      {/if}
                    </tr>
                  {/each}
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <section class="panel rounded-md">
        <PanelHeader
          description="In the state, but deleted on the instance. terraform plan creates them again."
          icon={SearchX}
          title="Missing"
        />
        {#if report.missing.length === 0}
          <p class="text-text-muted px-5 py-4 text-sm">Nothing in the state is missing.</p>
        {:else}
          <ul class="divide-border divide-y">
            {#each report.missing as resource (resource.address)}
              <li class="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span class="text-text font-mono text-xs">{resource.address}</span>
                <span class="text-text-subtle font-mono text-xs">{resource.id}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <section class="panel rounded-md">
        <PanelHeader
          description="Running, but no resource in this state manages them. The Generate tab writes their import blocks."
          icon={PackagePlus}
          title="Unmanaged"
        />
        {#if report.unmanaged.length === 0}
          <p class="text-text-muted px-5 py-4 text-sm">Terraform manages everything.</p>
        {:else}
          <ul class="divide-border divide-y">
            {#each report.unmanaged as object (`${object.type}:${object.id}`)}
              <li class="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                <span class="text-text text-sm">{object.label}</span>
                <span class="text-text-subtle font-mono text-xs">{object.type}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </section>
    {/if}
  {/if}
</div>
