<script lang="ts">
	import { resolve } from "$app/paths";
	import { CircleX, HeartPulse, Rocket, Undo2 } from "@lucide/svelte";
	import type { Component } from "svelte";

	import {
		type DeployTrigger,
		deployTriggerLabel,
		isRollback,
	} from "#lib/deploy-trigger.js";
	import { timeAgo } from "#lib/formatting.js";
	import type { ContainerStatus, RevisionHealth } from "#lib/types.js";

	interface Deployment {
		createdAt: Date | string;
		errorMessage: string | null;
		finishedAt: Date | string | null;
		gitCommit: string | null;
		health: RevisionHealth | null;
		id: string;
		imageRef: string | null;
		rollbackOfDeploymentId: string | null;
		startedAt: Date | string | null;
		status: ContainerStatus;
		trigger: DeployTrigger | null;
	}

	interface Props {
		deployments: Deployment[];
		serviceId: string;
	}

	const { deployments, serviceId }: Props = $props();

	interface Entry {
		detail: string | null;
		icon: Component;
		id: string;
		text: string;
		tone: string;
		when: Date | string;
	}

	function seconds(dep: Deployment): number | null {
		return dep.startedAt && dep.finishedAt
			? Math.max(
					1,
					Math.round(
						(new Date(dep.finishedAt).getTime() -
							new Date(dep.startedAt).getTime()) /
							1000,
					),
				)
			: null;
	}

	function entryOf(dep: Deployment): Entry {
		const took = seconds(dep);
		const what = dep.gitCommit
			? dep.gitCommit.slice(0, 7)
			: (dep.imageRef?.split("/").pop() ?? null);
		const how = dep.trigger ? deployTriggerLabel(dep.trigger) : null;
		const detail =
			[how, what, took ? `${took}s` : null].filter(Boolean).join(" · ") || null;
		if (dep.status === "failed") {
			return {
				detail: dep.errorMessage ?? detail,
				icon: CircleX,
				id: dep.id,
				text: "Deploy failed",
				tone: "text-red-500",
				when: dep.createdAt,
			};
		}
		if (dep.health === "rolled_back" || dep.health === "unhealthy") {
			return {
				detail,
				icon: HeartPulse,
				id: dep.id,
				text:
					dep.health === "rolled_back"
						? "Unhealthy, rolled back"
						: "Deployed, unhealthy",
				tone: "text-amber-500",
				when: dep.createdAt,
			};
		}
		if (isRollback(dep.rollbackOfDeploymentId, dep.trigger)) {
			return {
				detail,
				icon: Undo2,
				id: dep.id,
				text: "Rolled back",
				tone: "text-(--lane-1)",
				when: dep.createdAt,
			};
		}
		return {
			detail,
			icon: Rocket,
			id: dep.id,
			text:
				dep.status === "running" || dep.status === "stopped"
					? "Deployed"
					: "Deploying",
			tone: "text-accent",
			when: dep.createdAt,
		};
	}

	const entries = $derived(deployments.slice(0, 8).map(entryOf));
</script>

<section class="space-y-2">
	<header class="flex items-baseline gap-2">
		<h2 class="text-text text-sm font-semibold">Activity</h2>
		<a
			class="text-accent ml-auto text-xs font-medium hover:underline"
			href={resolve(
				"/(protected)/services/[serviceId]/environments/revisions",
				{
					serviceId,
				},
			)}>All revisions</a
		>
	</header>
	{#if entries.length === 0}
		<p class="text-text-muted py-4 text-sm">Nothing deployed yet.</p>
	{:else}
		<ol class="relative">
			<span
				class="bg-border absolute top-3 bottom-3 left-2.5 w-px"
				aria-hidden="true"
			></span>
			{#each entries as entry (entry.id)}
				{@const Icon = entry.icon}
				<li>
					<a
						class="hover:bg-surface-2 relative -mx-2 grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-start gap-3 rounded-md px-2 py-2"
						href={resolve(
							"/(protected)/services/[serviceId]/environments/revisions/[revisionId]",
							{ revisionId: entry.id, serviceId },
						)}
					>
						<span
							class="bg-surface border-border grid size-5 place-items-center rounded-full border {entry.tone}"
						>
							<Icon class="size-3" />
						</span>
						<span class="min-w-0">
							<span class="text-text block text-sm font-medium"
								>{entry.text}</span
							>
							{#if entry.detail}
								<span class="text-text-muted block truncate font-mono text-xs"
									>{entry.detail}</span
								>
							{/if}
						</span>
						<span class="text-text-subtle pt-0.5 font-mono text-[0.6875rem]"
							>{timeAgo(entry.when)}</span
						>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
</section>
