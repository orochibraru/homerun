<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { ArrowRight, CircleX } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { onMount } from "svelte";

	import AvailableUpdates from "#lib/components/available-updates.svelte";
	import LaneStrip from "#lib/components/lane-strip.svelte";
	import ChangeBadge from "#lib/components/monitoring/change-badge.svelte";
	import QuickDeployTemplates from "#lib/components/overview/quick-deploy-templates.svelte";
	import SetupIssues from "#lib/components/overview/setup-issues.svelte";
	import TrafficAndHost from "#lib/components/overview/traffic-and-host.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import StatusDot from "#lib/components/status-dot.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import {
		formatCount as count,
		formatMs as ms,
		formatPercent as percent,
	} from "#lib/metrics-format.js";
	import { monitoringChanges } from "#lib/monitoring-changes.js";
	import { can } from "#lib/permissions.js";
	import { getLanes } from "#lib/remote/lanes.remote.js";
	import { title } from "#lib/store/title.js";
	import { Streamed } from "#lib/streamed.svelte.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	const statsData = new Streamed(
		() => `dashboard:stats:${data.user.id}`,
		() => data.stats,
	);
	const deploymentsData = new Streamed(
		() => `dashboard:deployments:${data.user.id}`,
		() => data.recentDeployments,
	);
	const errorsData = new Streamed(
		() => `dashboard:errors:${data.user.id}`,
		() => data.recentErrors,
	);
	const uptimeData = new Streamed(
		() => `dashboard:uptime:${data.user.id}`,
		() => data.uptimeDown,
	);
	const monitoringData = new Streamed(
		() => `dashboard:monitoring:${data.user.id}`,
		() => data.monitoring,
	);
	const overCapacityData = new Streamed(
		() => "dashboard:over-capacity",
		() => data.overCapacity,
	);
	const templatesData = new Streamed(
		() => `dashboard:templates:${data.user.id}`,
		() => data.frontPageTemplates,
	);
	const updatesData = new Streamed(
		() => `dashboard:updates:${data.user.id}`,
		() => data.availableUpdates,
	);
	const stats = $derived(statsData.current);
	const updates = $derived(updatesData.current);
	const deployments = $derived(deploymentsData.current);
	const errors = $derived(errorsData.current);
	const uptimeDown = $derived(uptimeData.current);
	const monitoring = $derived(monitoringData.current);
	const overCapacity = $derived(overCapacityData.current);
	const frontPageTemplates = $derived(templatesData.current);

	const traffic = $derived(monitoring?.monitoring.traffic);
	const changes = $derived(
		monitoring ? monitoringChanges(monitoring.monitoring) : {},
	);
	const busiest = $derived(monitoring?.busiest ?? []);
	const lanes = $derived(getLanes(busiest.map((row) => row.serviceId)));

	const timeline = $derived(
		[
			...(deployments ?? []).map((dep) => ({
				at: dep.createdAt,
				href: `${resolve("services")}/${dep.serviceId}`,
				id: `dep:${dep.id}`,
				subject: dep.serviceName ?? "Unknown service",
				text:
					dep.status === "failed"
						? (dep.errorMessage ?? "deploy failed")
						: `deployed${dep.startedAt && dep.finishedAt ? ` in ${Math.max(1, Math.round((new Date(dep.finishedAt).getTime() - new Date(dep.startedAt).getTime()) / 1000))}s` : ""}`,
				tone: dep.status === "failed" ? "bg-red-500" : "bg-(--lane-1)",
			})),
			...(errors ?? []).map((entry) => ({
				at: entry.createdAt,
				href: entry.serviceId
					? `${resolve("services")}/${entry.serviceId}/observability/errors/app-errors`
					: resolve("system-logs"),
				id: `log:${entry.id}`,
				subject: entry.serviceName ?? entry.scope ?? "Instance",
				text: entry.message,
				tone: entry.level === "error" ? "bg-red-500" : "bg-amber-500",
			})),
		]
			.toSorted((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
			.slice(0, 7),
	);

	const needsYou = $derived(
		(uptimeDown?.length ?? 0) +
			(overCapacity?.length ? 1 : 0) +
			(updates?.length ?? 0),
	);

	let clearingErrors = $state(false);
	onMount(() => {
		title.set("Dashboard");
	});
</script>

<div class="p-5 md:p-8">
	<section class="mb-8">
		<h1 class="text-text text-2xl font-semibold tracking-tight">
			Welcome back, {data.user?.name?.split(" ")[0]}.
		</h1>
		<p
			class="text-text-muted mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-[0.9375rem]"
		>
			<span>
				<b
					class="font-semibold text-emerald-600 tabular-nums dark:text-emerald-400"
					>{statsData.failed
						? "–"
						: `${stats?.running ?? 0}/${stats?.totalServices ?? 0}`}</b
				>
				running
			</span>
			{#if traffic}
				<span class="inline-flex items-center gap-1.5">
					<b class="text-text font-semibold tabular-nums"
						>{count(traffic.requests)}</b
					>
					requests
					<ChangeBadge change={changes.requests} />
				</span>
				<span class="inline-flex items-center gap-1.5">
					<b class="text-text font-semibold tabular-nums"
						>{ms(traffic.avgResponseMs)}</b
					>
					avg
					<ChangeBadge change={changes.avgResponse} />
				</span>
				<span class="inline-flex items-center gap-1.5">
					<b class="text-text font-semibold tabular-nums"
						>{percent(
							traffic.status4xx + traffic.status5xx,
							traffic.requests,
						)}</b
					>
					errors
					<ChangeBadge change={changes.errorRate} />
				</span>
			{:else if !monitoringData.failed}
				<Skeleton class="h-4 w-64" />
			{/if}
		</p>
	</section>

	<SetupIssues permissions={data.permissions} />

	{#if needsYou > 0}
		<section class="mb-8">
			<h2
				class="text-text mb-3 flex items-baseline gap-2 text-sm font-semibold"
			>
				Needs you
				<span class="text-text-subtle font-mono text-xs font-normal"
					>{needsYou}</span
				>
			</h2>
			<div class="grid grid-cols-1 gap-3 lg:grid-cols-2">
				{#if updates?.length}
					<AvailableUpdates
						canWrite={can(data.permissions, "services", "write")}
						{updates}
					/>
				{/if}
				{#if overCapacity?.length}
					<div
						class="border-border relative rounded-lg border p-4 before:absolute before:inset-y-3 before:-left-px before:w-0.75 before:rounded-full before:bg-red-500"
					>
						<p class="text-text flex items-center gap-2 text-sm font-semibold">
							<CircleX class="size-4 text-red-500" />
							Server past its hard resource limit
						</p>
						<p class="text-text-muted mt-1 text-sm">
							{overCapacity.join(", ")}. New services are refused until usage
							drops back.
						</p>
						{#if data.readsSettings}
							<Button
								class="mt-3"
								href={resolve("settings")}
								size="sm"
								variant="outline">Limits</Button
							>
						{/if}
					</div>
				{/if}
				{#each uptimeDown ?? [] as check (check.serviceId + check.kind)}
					<div
						class="border-border relative rounded-lg border p-4 before:absolute before:inset-y-3 before:-left-px before:w-0.75 before:rounded-full before:bg-red-500"
					>
						<p class="text-text flex items-center gap-2 text-sm font-semibold">
							<span class="size-2 rounded-full bg-red-500"></span>
							{check.serviceName}
							{check.kind === "internal"
								? "isn't answering on the network"
								: "isn't responding"}
						</p>
						<p class="text-text-muted mt-1 truncate text-sm">
							{check.detail ?? ""}{check.target ? ` (${check.target})` : ""}
						</p>
						<Button
							class="mt-3"
							href="{resolve(
								'services',
							)}/{check.serviceId}/observability/uptime"
							size="sm"
							variant="outline">Uptime</Button
						>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if frontPageTemplates?.length}
		<QuickDeployTemplates templates={frontPageTemplates} />
	{/if}

	<TrafficAndHost failed={monitoringData.failed} {monitoring} />

	<div
		class="grid grid-cols-1 gap-x-12 gap-y-8 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]"
	>
		<section>
			<header class="mb-2 flex items-baseline gap-2">
				<h2 class="text-text text-sm font-semibold">Busiest today</h2>
				<a
					class="text-accent ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
					href={resolve("services")}
				>
					All {stats?.totalServices ?? ""} services <ArrowRight
						class="size-3"
					/>
				</a>
			</header>
			{#if !monitoring}
				{#if monitoringData.failed}
					<p class="text-text-muted py-6 text-sm">
						Couldn't load today's traffic.
					</p>
				{:else}
					<div class="space-y-3 py-2">
						<Skeleton class="h-8 w-full" />
						<Skeleton class="h-8 w-full" />
						<Skeleton class="h-8 w-2/3" />
					</div>
				{/if}
			{:else if busiest.length === 0}
				<p class="text-text-muted py-6 text-sm">
					No traffic recorded yet today.
				</p>
			{:else}
				<ul>
					{#each busiest as row (row.serviceId)}
						<li
							class="border-border grid h-11 grid-cols-[11rem_minmax(0,1fr)_4.5rem] items-center gap-4 border-b sm:grid-cols-[15rem_minmax(0,1fr)_5rem]"
						>
							<a
								class="flex min-w-0 items-center gap-2.5 hover:underline"
								href={row.href}
							>
								<StatusDot status={row.status} />
								<span class="text-text truncate text-sm font-medium"
									>{row.name}</span
								>
								<span
									class="text-text-subtle hidden truncate font-mono text-[0.6875rem] sm:inline"
									>{row.slug}</span
								>
							</a>
							<LaneStrip lane={lanes.current?.[row.serviceId]} />
							<span
								class="text-text-muted text-right font-mono text-xs tabular-nums"
								>{count(row.requests)}</span
							>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<section>
			<header class="mb-2 flex items-baseline gap-3">
				<h2 class="text-text text-sm font-semibold">Today</h2>
				{#if errors?.length && can(data.permissions, "services", "write")}
					<form
						class="ml-auto"
						action="?/clearErrors"
						method="POST"
						use:enhance={enhanceToast({
							error: "Couldn't clear the errors.",
							loading: "Clearing errors",
							onSettled: () => {
								clearingErrors = false;
							},
							onStart: () => {
								clearingErrors = true;
							},
							success: "Errors cleared.",
						})}
					>
						<button
							class="text-text-muted hover:text-text text-xs font-medium disabled:opacity-50"
							disabled={clearingErrors}
							type="submit"
						>
							Clear errors
						</button>
					</form>
				{/if}
				<a
					class="text-accent text-xs font-medium hover:underline {errors?.length
						? ''
						: 'ml-auto'}"
					href={resolve("deployments")}>Deployments</a
				>
			</header>
			{#if !deployments || !errors}
				<div class="space-y-3 py-2">
					<Skeleton class="h-5 w-full" />
					<Skeleton class="h-5 w-4/5" />
					<Skeleton class="h-5 w-2/3" />
				</div>
			{:else if timeline.length === 0}
				<p class="text-text-muted py-6 text-sm">
					Nothing deployed or logged yet.
				</p>
			{:else}
				<ol>
					{#each timeline as event (event.id)}
						<li>
							<a
								class="hover:bg-surface-2 -mx-2 grid grid-cols-[3.5rem_0.75rem_minmax(0,1fr)] items-start gap-2.5 rounded-md px-2 py-2"
								href={event.href}
							>
								<span
									class="text-text-subtle pt-0.5 text-right font-mono text-[0.6875rem] tabular-nums"
									>{timeAgo(event.at)}</span
								>
								<span class="mt-1.5 size-2 rounded-full {event.tone}"></span>
								<span class="text-text-muted min-w-0 truncate text-sm">
									<b class="text-text font-medium">{event.subject}</b>
									{event.text}
								</span>
							</a>
						</li>
					{/each}
				</ol>
			{/if}
		</section>
	</div>
</div>
