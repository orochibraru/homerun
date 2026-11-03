<script lang="ts">
	import { resolve } from "$app/paths";
	import {
		CircleCheck,
		CircleX,
		HeartPulse,
		History,
		Loader2,
		Undo2,
	} from "@lucide/svelte";
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
		running: boolean;
		serviceId: string;
	}

	const { deployments, running, serviceId }: Props = $props();

	interface Pill {
		class: string;
		icon: Component<{ class?: string }>;
		label: string;
		spin?: boolean;
	}

	const PILLS = {
		deploying: {
			class: "text-blue-600 dark:text-blue-400",
			icon: Loader2,
			label: "Deploying",
			spin: true,
		},
		failed: {
			class: "text-red-600 dark:text-red-400",
			icon: CircleX,
			label: "Failed",
		},
		live: {
			class: "text-emerald-600 dark:text-emerald-400",
			icon: CircleCheck,
			label: "Live",
		},
		replaced: { class: "text-text-muted", icon: History, label: "Replaced" },
		rolledBack: {
			class: "text-amber-600 dark:text-amber-400",
			icon: Undo2,
			label: "Rolled back",
		},
		stopped: {
			class: "text-orange-600 dark:text-orange-400",
			icon: CircleX,
			label: "Stopped",
		},
		unhealthy: {
			class: "text-amber-600 dark:text-amber-400",
			icon: HeartPulse,
			label: "Unhealthy",
		},
	} satisfies Record<string, Pill>;

	function version(dep: Deployment): string {
		if (dep.gitCommit) {
			return dep.gitCommit.slice(0, 7);
		}
		const ref = dep.imageRef;
		if (!ref) {
			return "—";
		}
		const colon = ref.lastIndexOf(":");
		return colon > ref.lastIndexOf("/") ? ref.slice(colon + 1) : "latest";
	}

	function title(dep: Deployment): string {
		if (dep.status === "failed") {
			return "Deploy failed";
		}
		if (isRollback(dep.rollbackOfDeploymentId, dep.trigger)) {
			return "Rollback";
		}
		return dep.trigger ? `${deployTriggerLabel(dep.trigger)} deploy` : "Deploy";
	}

	function duration(dep: Deployment): string | null {
		if (!(dep.startedAt && dep.finishedAt)) {
			return null;
		}
		const seconds = Math.max(
			1,
			Math.round(
				(new Date(dep.finishedAt).getTime() -
					new Date(dep.startedAt).getTime()) /
					1000,
			),
		);
		return seconds >= 60
			? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
			: `${seconds}s`;
	}

	const rows = $derived.by(() => {
		let currentSeen = false;
		return deployments.slice(0, 3).map((dep) => {
			let pill: Pill = PILLS.replaced;
			if (dep.status === "failed") {
				pill = PILLS.failed;
			} else if (
				dep.status === "pending" ||
				dep.status === "pulling" ||
				dep.status === "starting"
			) {
				pill = PILLS.deploying;
			} else if (dep.health === "rolled_back") {
				pill = PILLS.rolledBack;
			} else if (dep.health === "unhealthy") {
				pill = PILLS.unhealthy;
			} else if (!currentSeen) {
				currentSeen = true;
				pill = running ? PILLS.live : PILLS.stopped;
			}
			return {
				duration: duration(dep),
				id: dep.id,
				pill,
				title: title(dep),
				version: version(dep),
				when: dep.createdAt,
			};
		});
	});
</script>

<section class="panel flex flex-col rounded-[1.125rem] px-5 pt-4.5 pb-2">
	<div class="mb-1.5 flex items-center">
		<h2 class="text-text text-[1.0625rem] font-[650] tracking-tight">
			Revisions
		</h2>
		<a
			class="text-text-subtle hover:text-text ml-auto text-[0.78rem] font-semibold"
			href={resolve(
				"/(protected)/services/[serviceId]/environments/revisions",
				{ serviceId },
			)}
		>
			See all
		</a>
	</div>
	{#if rows.length === 0}
		<p class="text-text-muted grid flex-1 place-items-center py-8 text-sm">
			Nothing deployed yet.
		</p>
	{:else}
		<ol>
			{#each rows as row, i (row.id)}
				<li class={i > 0 ? "border-border border-t" : ""}>
					<a
						class="group flex h-13 items-center gap-3"
						href={resolve(
							"/(protected)/services/[serviceId]/environments/revisions/[revisionId]",
							{ revisionId: row.id, serviceId },
						)}
					>
						<span
							class="bg-surface-2 text-text max-w-24 shrink-0 truncate rounded-full px-2 py-0.75 font-mono text-xs font-semibold"
							title={row.version}
						>
							{row.version}
						</span>
						<span class="min-w-0 leading-tight">
							<span
								class="text-text block truncate text-[0.8125rem] font-[650] group-hover:underline"
								>{row.title}</span
							>
							<span class="text-text-subtle block truncate text-[0.6875rem]">
								{timeAgo(row.when)}{row.duration ? ` · ${row.duration}` : ""}
							</span>
						</span>
						<span
							class="border-border-light bg-surface ml-auto inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pr-3 pl-2.5 text-xs font-bold {row
								.pill.class}"
						>
							<row.pill.icon
								class="size-3.5 {row.pill.spin ? 'animate-spin' : ''}"
							/>
							{row.pill.label}
						</span>
					</a>
				</li>
			{/each}
		</ol>
	{/if}
</section>
