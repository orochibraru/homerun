<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		CalendarClock,
		ChevronRight,
		GitCommitHorizontal,
		Hand,
		RotateCcw,
		Upload,
	} from "@lucide/svelte";

	import type { ActivityDeployment, ActivitySnapshot } from "#lib/activity.js";
	import { elapsedSeconds, formatElapsed } from "#lib/activity.js";
	import Skeleton from "#lib/components/skeleton.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import { historyTrigger, historyTriggerLabel } from "#lib/deploy-trigger.js";
	import { timeAgo } from "#lib/formatting.js";

	interface Props {
		/** The clock the running deploys' durations tick against. */
		now: number;
		/** Each service's icon and category by id, for the row's tile. */
		serviceIcons: Record<
			string,
			{ category: string | null; icon: string | null }
		>;
		/** The live activity feed, null until its first snapshot. */
		snapshot: ActivitySnapshot | null;
	}

	const { now, serviceIcons, snapshot }: Props = $props();

	const ROWS = 4;
	const TRIGGER_ICONS = {
		cron: CalendarClock,
		manual: Hand,
		promote: Upload,
		push: GitCommitHorizontal,
		rollback: RotateCcw,
	} as const;

	const rows = $derived(
		snapshot ? [...snapshot.deploying, ...snapshot.recent].slice(0, ROWS) : [],
	);
	const servicesHref = resolve("services");

	/** What a deploy shipped: its commit, else the image tag it ran, else how it was started. */
	function change(dep: ActivityDeployment): string {
		if (dep.gitCommit) {
			return dep.gitCommit.slice(0, 7);
		}
		if (dep.imageRef) {
			return dep.imageRef.split("/").at(-1) ?? dep.imageRef;
		}
		return historyTriggerLabel(historyTrigger(null, dep.trigger));
	}
</script>

<section class="panel min-w-0 rounded-2xl px-5.5 pt-4.5 pb-1.5">
	<header class="mb-2 flex items-center gap-2.5">
		<h2 class="text-[1.0625rem] font-semibold tracking-tight">Deployments</h2>
		{#if snapshot?.deploying.length}
			<span
				class="bg-surface-2 text-text-muted rounded-full px-2.25 py-0.75 text-[0.6875rem] font-bold"
				>{snapshot.deploying.length} running</span
			>
		{/if}
		<a
			class="border-border-light bg-surface text-text-muted hover:text-text ml-auto inline-flex h-7.5 items-center gap-1 rounded-full border pr-2 pl-3 text-xs font-semibold transition-colors"
			href={resolve("deployments")}
		>
			All deployments <ChevronRight class="size-3.5" />
		</a>
	</header>

	<div
		class="text-text-subtle border-border grid h-9 grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_7.5rem_1rem] items-center gap-3.5 border-b text-xs font-semibold md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_7.5rem_1rem]"
	>
		<span>Service</span>
		<span class="max-md:hidden">Change</span>
		<span>Started</span>
		<span class="max-md:hidden">Duration</span>
		<span>Status</span>
		<span></span>
	</div>

	{#if !snapshot}
		<div class="space-y-3 py-3">
			<Skeleton class="h-8 w-full" />
			<Skeleton class="h-8 w-full" />
			<Skeleton class="h-8 w-2/3" />
		</div>
	{:else if rows.length === 0}
		<p class="text-text-muted py-6 text-sm">Nothing deployed yet.</p>
	{:else}
		<ul>
			{#each rows as dep (dep.id)}
				{@const trigger = historyTrigger(null, dep.trigger)}
				{@const TriggerIcon = trigger ? TRIGGER_ICONS[trigger] : Upload}
				<li class="border-border not-first:border-t">
					<a
						class="hover:bg-surface-2 -mx-5.5 grid h-12.5 grid-cols-[minmax(0,1.4fr)_minmax(0,0.8fr)_7.5rem_1rem] items-center gap-3.5 px-5.5 text-[0.8125rem] transition-colors md:grid-cols-[minmax(0,1.4fr)_minmax(0,1.6fr)_minmax(0,0.8fr)_minmax(0,0.8fr)_7.5rem_1rem]"
						href="{servicesHref}/{dep.serviceId}"
						title={dep.status === "failed"
							? (dep.errorMessage ?? "Deploy failed")
							: undefined}
					>
						<span class="flex min-w-0 items-center gap-2.5">
							<TemplateIcon
								category={serviceIcons[dep.serviceId]?.category ?? null}
								class="size-7 rounded-lg"
								icon={serviceIcons[dep.serviceId]?.icon ?? null}
							/>
							<b class="truncate font-bold">{dep.serviceName}</b>
							{#if dep.environment !== "production"}
								<span class="text-text-subtle truncate text-xs"
									>{dep.environment}</span
								>
							{/if}
						</span>
						<span
							class="text-text-muted flex min-w-0 items-center gap-1.75 max-md:hidden"
						>
							<TriggerIcon class="text-text-subtle size-3.5 shrink-0" />
							<span
								class="truncate {dep.gitCommit || dep.imageRef
									? 'font-mono text-xs'
									: ''}">{change(dep)}</span
							>
						</span>
						<span class="text-text-muted truncate"
							>{timeAgo(dep.createdAt)}</span
						>
						<span class="text-text-muted tabular-nums max-md:hidden">
							{dep.startedAt
								? formatElapsed(
										elapsedSeconds(dep.startedAt, dep.finishedAt, now),
									)
								: "—"}
						</span>
						<span><StatusBadge status={dep.status} /></span>
						<ChevronRight class="text-text-subtle size-4" />
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</section>
