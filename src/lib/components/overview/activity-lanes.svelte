<script lang="ts">
	import { resolve } from "$app/paths";
	import { ArrowRight } from "@lucide/svelte";

	import { ActivityFeedClient } from "#lib/activity-feed.svelte.js";
	import type { ActivityAlert } from "#lib/activity.js";
	import { elapsedSeconds, formatElapsed } from "#lib/activity.js";
	import Skeleton from "#lib/components/skeleton.svelte";
	import StatusDot from "#lib/components/status-dot.svelte";
	import { JOB_TYPE_LABELS, SERVICE_STATUS_CONFIG } from "#lib/constants.js";
	import { historyTrigger, historyTriggerLabel } from "#lib/deploy-trigger.js";
	import { timeAgo } from "#lib/formatting.js";

	const feed = new ActivityFeedClient();
	const snapshot = $derived(feed.snapshot);
	const servicesHref = resolve("services");

	/** Link to one service's page. */
	function serviceHref(serviceId: string): string {
		return `${servicesHref}/${serviceId}`;
	}

	/** Where an alert leads: the issue's page, or the service's application errors for a logged line. */
	function alertHref(alert: ActivityAlert): string {
		const base = `${serviceHref(alert.serviceId)}/observability/errors`;
		return alert.kind === "issue"
			? `${base}/${alert.id}`
			: `${base}/app-errors`;
	}

	/** How a deploy was started, for the lane's subtitle. */
	function triggerLabel(trigger: string | null): string {
		return historyTriggerLabel(historyTrigger(null, trigger));
	}
</script>

<section class="mb-10">
	<header class="mb-3 flex items-baseline gap-2">
		<h2 class="text-text text-sm font-semibold">Activity</h2>
		<span
			class="text-text-subtle inline-flex items-center gap-1.5 text-xs"
			title={feed.connected
				? "Updates live as deploys and jobs move"
				: "Reconnecting to the live feed"}
		>
			<span class="relative inline-flex size-1.5">
				{#if feed.connected}
					<span
						class="absolute inset-0 animate-ping rounded-full bg-emerald-500 opacity-60"
					></span>
				{/if}
				<span
					class="relative size-1.5 rounded-full {feed.connected
						? 'bg-emerald-500'
						: 'bg-slate-400'}"
				></span>
			</span>
			{feed.connected ? "live" : "connecting"}
		</span>
		<a
			class="text-accent ml-auto inline-flex items-center gap-1 text-xs font-medium hover:underline"
			href={resolve("deployments")}
		>
			All deployments <ArrowRight class="size-3" />
		</a>
	</header>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
		<div class="border-border rounded-lg border p-4">
			<h3
				class="text-text-muted mb-3 flex items-baseline gap-2 text-xs font-semibold tracking-wide uppercase"
			>
				Deploying now
				<span class="text-text-subtle font-mono font-normal"
					>{snapshot?.deploying.length ?? ""}</span
				>
			</h3>
			{#if !snapshot}
				<div class="space-y-3">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-3/4" />
				</div>
			{:else if snapshot.deploying.length === 0}
				<p class="text-text-subtle py-3 text-sm">Nothing deploying.</p>
			{:else}
				<ul class="space-y-3">
					{#each snapshot.deploying as dep (dep.id)}
						<li>
							<a
								class="hover:bg-surface-2 -mx-2 block rounded-md px-2 py-1.5"
								href={serviceHref(dep.serviceId)}
							>
								<span class="flex items-center gap-2">
									<StatusDot status={dep.status} />
									<span class="text-text truncate text-sm font-medium"
										>{dep.serviceName}</span
									>
									{#if dep.environment !== "production"}
										<span class="text-text-subtle font-mono text-[0.6875rem]"
											>{dep.environment}</span
										>
									{/if}
									<span
										class="text-text-muted ml-auto font-mono text-xs tabular-nums"
										>{formatElapsed(
											elapsedSeconds(
												dep.startedAt ?? dep.createdAt,
												null,
												feed.now,
											),
										)}</span
									>
								</span>
								<span
									class="text-text-muted mt-1 block truncate font-mono text-[0.6875rem]"
								>
									{SERVICE_STATUS_CONFIG[dep.status]?.label ??
										dep.status}{dep.lastLine ? ` · ${dep.lastLine}` : ""}
								</span>
								<span
									class="bg-surface-2 mt-2 block h-0.5 overflow-hidden rounded-full"
								>
									<span
										class="block h-full w-1/3 animate-pulse rounded-full bg-blue-500"
									></span>
								</span>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="border-border rounded-lg border p-4">
			<h3
				class="text-text-muted mb-3 flex items-baseline gap-2 text-xs font-semibold tracking-wide uppercase"
			>
				Alerts
				<span
					class="font-mono font-normal {snapshot?.alerts.length
						? 'text-red-500'
						: 'text-text-subtle'}">{snapshot?.alerts.length ?? ""}</span
				>
			</h3>
			{#if !snapshot}
				<div class="space-y-3">
					<Skeleton class="h-10 w-full" />
					<Skeleton class="h-10 w-2/3" />
				</div>
			{:else if snapshot.alerts.length === 0}
				<p class="text-text-subtle py-3 text-sm">
					No errors in the last 24 hours.
				</p>
			{:else}
				<ul class="space-y-1">
					{#each snapshot.alerts as alert (alert.kind + alert.id)}
						<li>
							<a
								class="hover:bg-surface-2 -mx-2 block rounded-md px-2 py-1.5"
								href={alertHref(alert)}
							>
								<span class="flex items-center gap-2">
									<span class="size-2 shrink-0 rounded-full bg-red-500"></span>
									<span class="text-text truncate text-sm font-medium"
										>{alert.serviceName}</span
									>
									{#if alert.count > 1}
										<span
											class="shrink-0 rounded-sm bg-red-500/10 px-1 font-mono text-[0.6875rem] text-red-600 tabular-nums dark:text-red-400"
											>×{alert.count}</span
										>
									{/if}
									<span
										class="text-text-subtle ml-auto shrink-0 font-mono text-[0.6875rem] tabular-nums"
										>{timeAgo(alert.at)}</span
									>
								</span>
								<span class="text-text-muted mt-0.5 block truncate text-xs"
									>{alert.title}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="border-border rounded-lg border p-4">
			<h3
				class="text-text-muted mb-3 flex items-baseline gap-2 text-xs font-semibold tracking-wide uppercase"
			>
				Jobs
				<span class="text-text-subtle font-mono font-normal"
					>{snapshot?.jobs.length ?? ""}</span
				>
				<a
					class="text-accent ml-auto text-xs font-medium normal-case hover:underline"
					href={resolve("scheduling")}>Queue</a
				>
			</h3>
			{#if !snapshot}
				<div class="space-y-3">
					<Skeleton class="h-6 w-full" />
					<Skeleton class="h-6 w-2/3" />
				</div>
			{:else if snapshot.jobs.length === 0}
				<p class="text-text-subtle py-3 text-sm">Queue is empty.</p>
			{:else}
				<ul class="space-y-1">
					{#each snapshot.jobs as entry (entry.id)}
						<li class="flex items-center gap-2 py-1">
							<span
								class="size-2 shrink-0 rounded-full {entry.status === 'running'
									? 'animate-pulse bg-blue-500'
									: 'bg-slate-400'}"
							></span>
							<span class="text-text min-w-0 truncate text-sm"
								>{entry.title}</span
							>
							<span class="text-text-subtle shrink-0 text-[0.6875rem]"
								>{JOB_TYPE_LABELS[entry.type] ?? entry.type}</span
							>
							<span
								class="text-text-muted ml-auto shrink-0 font-mono text-xs tabular-nums"
							>
								{entry.status === "running" && entry.startedAt
									? formatElapsed(
											elapsedSeconds(entry.startedAt, null, feed.now),
										)
									: "queued"}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<div class="border-border rounded-lg border p-4">
			<h3
				class="text-text-muted mb-3 text-xs font-semibold tracking-wide uppercase"
			>
				Recently deployed
			</h3>
			{#if !snapshot}
				<div class="space-y-3">
					<Skeleton class="h-6 w-full" />
					<Skeleton class="h-6 w-full" />
					<Skeleton class="h-6 w-2/3" />
				</div>
			{:else if snapshot.recent.length === 0}
				<p class="text-text-subtle py-3 text-sm">Nothing deployed yet.</p>
			{:else}
				<ul class="space-y-0.5">
					{#each snapshot.recent as dep (dep.id)}
						<li>
							<a
								class="hover:bg-surface-2 -mx-2 flex items-center gap-2 rounded-md px-2 py-1.5"
								href={serviceHref(dep.serviceId)}
								title={dep.status === "failed"
									? (dep.errorMessage ?? "Deploy failed")
									: (dep.imageRef ?? undefined)}
							>
								<StatusDot status={dep.status} />
								<span class="text-text min-w-0 truncate text-sm font-medium"
									>{dep.serviceName}</span
								>
								<span class="text-text-subtle shrink-0 text-[0.6875rem]">
									{dep.status === "failed"
										? "failed"
										: triggerLabel(dep.trigger).toLowerCase()}{dep.startedAt &&
									dep.finishedAt
										? ` · ${formatElapsed(elapsedSeconds(dep.startedAt, dep.finishedAt, feed.now))}`
										: ""}
								</span>
								<span
									class="text-text-subtle ml-auto shrink-0 font-mono text-[0.6875rem] tabular-nums"
									>{timeAgo(dep.createdAt)}</span
								>
							</a>
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</section>
