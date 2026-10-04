<script lang="ts">
	import { TriangleAlert } from "@lucide/svelte";
	import { JOB_STATUS_CONFIG, JOB_TYPE_LABELS } from "#lib/constants.js";
	import { timeAgo } from "#lib/formatting.js";
	import type { JobSummary } from "#lib/types.js";
	import { resolve } from "$app/paths";

	const { jobs }: { jobs: JobSummary[] } = $props();
</script>

<ul class="divide-border border-border divide-y rounded-md border">
	{#each jobs as entry (entry.id)}
		{@const meta = JOB_STATUS_CONFIG[entry.status]}
		<li class="flex flex-col gap-1 px-3 py-2 text-sm">
			<div class="flex flex-wrap items-center gap-2">
				{#if entry.stale}
					<span
						class="inline-flex items-center gap-1 rounded-sm border border-red-500/25 bg-red-500/10 px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] text-red-600 uppercase dark:text-red-400"
						title="No worker has reported on this job for over two minutes"
					>
						<TriangleAlert class="size-2.5" />
						Stuck
					</span>
				{/if}
				<span
					class="inline-flex items-center gap-1 rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {meta.class}"
				>
					{meta.label}
				</span>
				<span class="text-text min-w-0 truncate font-medium">{entry.title}</span
				>
			</div>
			<p class="text-text-muted text-xs">
				{JOB_TYPE_LABELS[entry.type]}
				{#if entry.serviceId}
					·
					<a
						class="text-accent underline"
						href={resolve(`services/${entry.serviceId}`)}
					>{entry.serviceName ?? "service"}</a>
				{/if}
				{#if entry.stage}
					· {entry.stage}
				{/if}
				· {entry.startedAt
					? `started ${timeAgo(entry.startedAt)}`
					: `queued ${timeAgo(entry.createdAt)}`}
				{#if entry.heartbeatAt}
					· last heartbeat {timeAgo(entry.heartbeatAt)}
				{/if}
			</p>
		</li>
	{/each}
</ul>
