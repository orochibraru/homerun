<script lang="ts">
	import { resolve } from "$app/paths";
	import { Siren } from "@lucide/svelte";
	import { onMount } from "svelte";

	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "#lib/components/entity-toolbar.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import { describeCauses, formatDuration } from "#lib/resource-incidents.js";
	import { RESOURCE_KINDS, RESOURCE_LABELS } from "#lib/resource-thresholds.js";
	import { title } from "#lib/store/title.js";

	import WatchedHosts from "./watched-hosts.svelte";

	const { data } = $props();

	onMount(() => title.set("Monitoring · Incidents"));

	const hostNames = $derived(
		new Map(data.hosts.map((host) => [host.id, host.name])),
	);

	const filters = $derived<FilterGroup[]>([
		{
			key: "host",
			label: "Host",
			options: [
				{ label: "This server", value: "local" },
				...data.hosts.map((host) => ({ label: host.name, value: host.id })),
			],
		},
		{
			key: "status",
			label: "Status",
			options: [
				{ label: "Ongoing", value: "open" },
				{ label: "Resolved", value: "resolved" },
			],
		},
		{
			key: "resource",
			label: "Resource",
			options: RESOURCE_KINDS.map((kind) => ({
				label: RESOURCE_LABELS[kind],
				value: kind,
			})),
		},
		{
			key: "level",
			label: "Limit",
			options: [
				{ label: "Hard limit", value: "hard" },
				{ label: "Soft limit", value: "soft" },
			],
		},
	]);

	function lasted(startedAt: Date, resolvedAt: Date | null): string {
		return formatDuration(
			(resolvedAt ? new Date(resolvedAt).getTime() : Date.now()) -
				new Date(startedAt).getTime(),
		);
	}
</script>

<div class="space-y-4">
	<p class="text-text-muted text-sm">
		Every time a resource on this server or a remote host stayed past its soft
		or hard limit (set in Settings): what was using it, how long it lasted, and
		the host's readings every minute it did. Remote hosts are measured through
		their Homerun agent.
	</p>

	<WatchedHosts hosts={data.hosts} watched={data.watched} />

	{#if data.total === 0 && !data.filtered}
		<EmptyState
			icon={Siren}
			subtitle="An incident opens once a resource stays past its limit for the time set in Settings."
			title="No incidents yet"
		/>
	{:else}
		<EntityToolbar
			{filters}
			placeholder="Search by what was using the resource…"
		/>
		{#if data.incidents.length === 0}
			<div
				class="border-border/70 rounded-md border border-dashed py-16 text-center"
			>
				<p class="text-text-muted text-sm">No incidents match your filters.</p>
			</div>
		{:else}
			<ul
				class="divide-border border-border panel divide-y rounded-md border text-sm"
			>
				{#each data.incidents as incident (incident.id)}
					<li>
						<a
							class="hover:bg-surface-2 flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3"
							href={resolve("/(protected)/monitoring/incidents/[incidentId]", {
								incidentId: incident.id,
							})}
						>
							<span class="text-text font-medium">
								{RESOURCE_LABELS[incident.kind]}
							</span>
							<span
								class="rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium {incident.level ===
								'hard'
									? 'bg-red-500/10 text-red-600 dark:text-red-400'
									: 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}"
							>
								{incident.level === "hard" ? "Hard limit" : "Soft limit"}
							</span>
							{#if !incident.resolvedAt}
								<span
									class="bg-accent/10 text-accent rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium"
								>
									Ongoing
								</span>
							{/if}
							<span class="text-text-muted text-xs">
								{incident.remoteHostId
									? (hostNames.get(incident.remoteHostId) ?? "A remote host")
									: "This server"}
							</span>
							<span class="text-text-muted text-xs">
								peak {incident.peakPercent}%
							</span>
							<span class="text-text-subtle ml-auto text-xs">
								{new Date(incident.startedAt).toLocaleString()} ·
								{incident.resolvedAt ? "lasted" : "for"}
								{lasted(incident.startedAt, incident.resolvedAt)} ·
								{incident.notifications}
								{incident.notifications === 1 ? "alert" : "alerts"}
							</span>
							{#if incident.causes.length > 0}
								<p class="text-text-muted w-full truncate text-xs">
									Biggest users: {describeCauses(incident.causes)}
								</p>
							{/if}
						</a>
					</li>
				{/each}
			</ul>

			<Pagination
				label="incidents"
				page={data.page}
				perPage={data.perPage}
				total={data.total}
			/>
		{/if}
	{/if}
</div>
