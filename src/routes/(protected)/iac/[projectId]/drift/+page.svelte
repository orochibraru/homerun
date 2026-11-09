<script lang="ts">
	import {
		CircleCheck,
		GitCompareArrows,
		PackagePlus,
		SearchX,
	} from "@lucide/svelte";

	import EmptyState from "#lib/components/empty-state.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { formatDriftValue } from "#lib/iac/drift.js";
	import { IAC_TOOL_INFO } from "#lib/iac/tools.js";

	const { data } = $props();

	const tool = $derived(IAC_TOOL_INFO[data.project.tool]);
</script>

<div class="space-y-5">
	{#if data.stacks.length > 1}
		<nav class="flex flex-wrap items-center gap-1.5" aria-label="Pulumi stacks">
			{#each data.stacks as stack (stack)}
				<a
					class="rounded-full px-2.5 py-1 font-mono text-xs {stack ===
					data.stack
						? 'bg-surface-2 text-text font-bold'
						: 'text-text-muted hover:bg-surface-2'}"
					aria-current={stack === data.stack ? "page" : undefined}
					href={`?${new URLSearchParams({ stack })}`}
				>
					{stack}
				</a>
			{/each}
		</nav>
	{/if}
	{#if data.problem}
		<EmptyState
			icon={GitCompareArrows}
			subtitle={data.problem}
			title="Nothing to compare yet"
		/>
	{:else if data.report}
		{@const report = data.report}
		<p class="text-text-muted text-sm">
			{#if data.stack}
				Stack <span class="font-mono">{data.stack}</span> ·
			{/if}
			{report.inSync} in sync · {report.drifted.length} drifted ·
			{report.missing.length} missing · {report.unmanaged.length} unmanaged
		</p>

		<section class="panel rounded-md">
			<PanelHeader
				description={`Changed outside ${tool.label} since the last apply. ${tool.plan} shows them, and applying puts them back unless the configuration changes too.`}
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
							<tr
								class="border-border text-text-muted border-b text-left text-xs uppercase"
							>
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
										<td class="text-text px-4 py-2 font-mono text-xs"
											>{index === 0 ? resource.address : ""}</td
										>
										<td class="text-text-muted px-4 py-2 font-mono text-xs"
											>{change.attribute}</td
										>
										{#if change.sensitive}
											<td class="text-text-subtle px-4 py-2 text-xs" colspan="2"
												>Sensitive value changed</td
											>
										{:else}
											<td
												class="text-text-muted px-4 py-2 font-mono text-xs break-all"
												>{formatDriftValue(change.state)}</td
											>
											<td
												class="text-text px-4 py-2 font-mono text-xs break-all"
												>{formatDriftValue(change.live)}</td
											>
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
				description="In the state, but deleted on the instance. Applying creates them again."
				icon={SearchX}
				title="Missing"
			/>
			{#if report.missing.length === 0}
				<p class="text-text-muted px-5 py-4 text-sm">
					Nothing in the state is missing.
				</p>
			{:else}
				<ul class="divide-border divide-y">
					{#each report.missing as resource (resource.address)}
						<li
							class="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
						>
							<span class="text-text font-mono text-xs">{resource.address}</span
							>
							<span class="text-text-subtle font-mono text-xs"
								>{resource.id}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section class="panel rounded-md">
			<PanelHeader
				description="Running, but no resource in this state manages them. The Generate tab writes the configuration that imports them."
				icon={PackagePlus}
				title="Unmanaged"
			/>
			{#if report.unmanaged.length === 0}
				<p class="text-text-muted px-5 py-4 text-sm">
					{tool.label} manages everything.
				</p>
			{:else}
				<ul class="divide-border divide-y">
					{#each report.unmanaged as object (`${object.type}:${object.id}`)}
						<li
							class="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5"
						>
							<span class="text-text text-sm">{object.label}</span>
							<span class="text-text-subtle font-mono text-xs"
								>{object.type}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}
</div>
