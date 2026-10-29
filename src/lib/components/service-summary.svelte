<script lang="ts">
	import { Info } from "@lucide/svelte";

	import { timeAgo } from "#lib/formatting.js";
	import type { ContainerStatus } from "#lib/types.js";

	interface Props {
		lastDeployment: { at: Date | string; status: ContainerStatus } | null;
		mountCount: number;
		service: {
			buildSource: string;
			containerPort: number;
			cpuLimit: string | null;
			createdAt: Date | string;
			gitRef: string | null;
			gitRepo: string | null;
			gitUrl: string | null;
			healthcheckDisabled: boolean;
			image: string | null;
			memoryLimitMb: number | null;
			replicas: number;
			tag: string | null;
		};
	}

	const { lastDeployment, mountCount, service }: Props = $props();

	const DEPLOY_OUTCOME: Record<ContainerStatus, string> = {
		failed: "Failed",
		missing: "Lost its container",
		pending: "In progress",
		pulling: "In progress",
		running: "Succeeded",
		starting: "In progress",
		stopped: "Succeeded",
	};

	const rows = $derived([
		{
			label: "Source",
			value:
				service.buildSource === "git"
					? `${service.gitRepo ?? (service.gitUrl ?? "").replace(/^https?:\/\//, "").replace(/\.git$/, "")}@${service.gitRef ?? "main"}`
					: `${service.image}:${service.tag}`,
		},
		{
			label: "Last deploy",
			value: lastDeployment
				? `${DEPLOY_OUTCOME[lastDeployment.status]} · ${timeAgo(lastDeployment.at)}`
				: "Never deployed",
		},
		{
			label: "Replicas",
			value: String(service.replicas),
		},
		{
			label: "Limits",
			value: [
				service.cpuLimit ? `${service.cpuLimit} CPU` : "no CPU limit",
				service.memoryLimitMb
					? `${service.memoryLimitMb} MB`
					: "no memory limit",
			].join(" · "),
		},
		{
			label: "Port",
			value: String(service.containerPort),
		},
		{
			label: "Health check",
			value: service.healthcheckDisabled ? "Disabled" : "Enabled",
		},
		{
			label: "Volumes",
			value: mountCount > 0 ? `${mountCount} mounted` : "None",
		},
		{
			label: "Created",
			value: timeAgo(service.createdAt),
		},
	]);
</script>

<section class="panel rounded-xl">
	<div class="panel-head">
		<h2 class="eyebrow flex items-center gap-1.5">
			<Info class="size-3" />
			Summary
		</h2>
	</div>
	<dl class="divide-border divide-y">
		{#each rows as row (row.label)}
			<div class="flex items-center gap-3 px-4 py-2.5 text-sm">
				<dt class="text-text-subtle w-28 shrink-0 text-xs">{row.label}</dt>
				<dd class="text-text min-w-0 flex-1 truncate" title={row.value}>
					{row.value}
				</dd>
			</div>
		{/each}
	</dl>
</section>
