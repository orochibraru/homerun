<script lang="ts">
	import { resolve } from "$app/paths";
	import { ArrowLeft } from "@lucide/svelte";
	import { onMount } from "svelte";

	import PanelHeader from "#lib/components/panel-header.svelte";
	import {
		formatChange,
		formatCount,
		formatMs,
		formatPercent,
	} from "#lib/metrics-format.js";
	import { formatDuration } from "#lib/resource-incidents.js";
	import { RESOURCE_LABELS } from "#lib/resource-thresholds.js";
	import { title } from "#lib/store/title.js";

	import IncidentChart from "./incident-chart.svelte";

	const { data } = $props();

	onMount(() => title.set("Monitoring · Incident"));

	const incident = $derived(data.incident);
	const label = $derived(RESOURCE_LABELS[incident.kind]);
	const startedAt = $derived(new Date(incident.startedAt));
	const resolvedAt = $derived(
		incident.resolvedAt ? new Date(incident.resolvedAt) : null,
	);
	const lasted = $derived(
		formatDuration((resolvedAt?.getTime() ?? Date.now()) - startedAt.getTime()),
	);

	const facts = $derived([
		["Host", data.hostName ?? "This server"],
		["Started", startedAt.toLocaleString()],
		["Ended", resolvedAt ? resolvedAt.toLocaleString() : "Still ongoing"],
		[resolvedAt ? "Lasted" : "So far", lasted],
		["Peak", `${incident.peakPercent}%`],
		["Alerts sent", String(incident.notifications)],
	]);

	const trafficRows = $derived.by(() => {
		const traffic = data.traffic;
		if (!traffic) {
			return [];
		}
		const { before, during, minutes } = traffic;
		const rows: {
			after: string;
			before: string;
			change: ReturnType<typeof formatChange>;
			name: string;
		}[] = [
			{
				after: formatCount(during.requests / minutes),
				before: formatCount(before.requests / minutes),
				change: formatChange(during.requests, before.requests, {
					higherIsBetter: null,
				}),
				name: "Requests a minute",
			},
			{
				after: formatMs(during.avgResponseMs),
				before: formatMs(before.avgResponseMs),
				change: formatChange(during.avgResponseMs, before.avgResponseMs, {
					higherIsBetter: false,
				}),
				name: "Average response time",
			},
			{
				after: formatPercent(during.status5xx, during.requests, 2),
				before: formatPercent(before.status5xx, before.requests, 2),
				change:
					during.requests && before.requests
						? formatChange(
								(during.status5xx / during.requests) * 100,
								(before.status5xx / before.requests) * 100,
								{ higherIsBetter: false, points: true },
							)
						: null,
				name: "Server errors (5xx)",
			},
		];
		return rows;
	});

	const CHANGE_CLASSES = {
		better: "text-green-600 dark:text-green-400",
		same: "text-text-muted",
		worse: "text-red-600 dark:text-red-400",
	} as const;
</script>

<div class="space-y-6">
	<div class="space-y-3">
		<a
			class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
			href={resolve("/(protected)/monitoring/incidents")}
		>
			<ArrowLeft class="size-3.5" />
			All incidents
		</a>
		<div class="flex flex-wrap items-center gap-2">
			<h2 class="text-text text-base font-semibold">
				{label} past its {incident.level} limit on {data.hostName ??
					"this server"}
			</h2>
			{#if !resolvedAt}
				<span
					class="bg-accent/10 text-accent rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium"
				>
					Ongoing
				</span>
			{/if}
		</div>
		<dl class="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3 lg:grid-cols-6">
			{#each facts as [name, value] (name)}
				<div>
					<dt class="text-text-subtle text-xs">{name}</dt>
					<dd class="text-text text-sm font-medium">{value}</dd>
				</div>
			{/each}
		</dl>
	</div>

	<section class="panel rounded-md">
		<PanelHeader
			description="The biggest users of {label.toLowerCase()} when the incident last alerted."
			title="What triggered it"
		/>
		<div class="p-5">
			{#if incident.causes.length === 0}
				<p class="text-text-muted text-sm">
					{incident.kind === "gpu"
						? "A GPU has no per-container reading to name its users with."
						: "Its users couldn't be read when it alerted."}
				</p>
			{:else}
				<ul class="divide-border divide-y text-sm">
					{#each incident.causes as cause, index (index)}
						<li class="flex items-center justify-between gap-3 py-2">
							<span class="text-text truncate">{cause.label}</span>
							<span class="text-text-muted shrink-0 tabular-nums"
								>{cause.amount}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</section>

	<section class="panel rounded-md">
		<PanelHeader
			description="The host's readings every minute the incident lasted, from when the limit was first crossed."
			title="Resources over the incident"
		/>
		<div class="p-5">
			<IncidentChart
				kind={incident.kind}
				samples={incident.samples}
				threshold={data.thresholds[incident.kind]}
			/>
		</div>
	</section>

	{#if data.traffic}
		<section class="panel rounded-md">
			<PanelHeader
				description="Every service's requests through Traefik during the incident, against as long a stretch right before it."
				title="How the services performed"
			/>
			<div class="overflow-x-auto p-5">
				<table class="w-full text-sm">
					<thead>
						<tr class="text-text-subtle text-left text-xs">
							<th class="pb-2 font-medium"></th>
							<th class="pb-2 font-medium">Before</th>
							<th class="pb-2 font-medium">During</th>
							<th class="pb-2 font-medium">Change</th>
						</tr>
					</thead>
					<tbody class="divide-border divide-y">
						{#each trafficRows as row (row.name)}
							<tr>
								<td class="text-text py-2">{row.name}</td>
								<td class="text-text-muted py-2 tabular-nums">{row.before}</td>
								<td class="text-text py-2 font-medium tabular-nums"
									>{row.after}</td
								>
								<td
									class="py-2 tabular-nums {row.change
										? CHANGE_CLASSES[row.change.direction]
										: 'text-text-subtle'}"
								>
									{row.change?.text ?? "—"}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		</section>
	{/if}
</div>
