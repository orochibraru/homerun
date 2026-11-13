<script lang="ts">
	import { Server } from "@lucide/svelte";

	import { RESOURCE_LABELS } from "#lib/resource-thresholds.js";
	import type { HostWatch } from "#lib/services/capacity.service.js";

	interface Props {
		hosts: { enabled: boolean; id: string; measured: boolean; name: string }[];
		watched: HostWatch[];
	}

	const { hosts, watched }: Props = $props();

	const unread = $derived(
		hosts.filter(
			(host) =>
				host.enabled &&
				!watched.some((watch) => watch.remoteHostId === host.id),
		),
	);

	const LEVEL_CLASSES = {
		hard: "text-red-600 dark:text-red-400",
		ok: "text-text",
		soft: "text-amber-600 dark:text-amber-400",
	} as const;
</script>

<div
	class="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4"
>
	{#each watched as watch (watch.remoteHostId ?? "local")}
		<div class="panel rounded-md p-4">
			<div class="mb-3 flex items-center gap-2">
				<Server class="text-text-subtle size-4" />
				<span class="text-text truncate text-sm font-medium">{watch.name}</span>
				<span class="text-text-subtle ml-auto shrink-0 text-xs">
					{new Date(watch.at).toLocaleTimeString()}
				</span>
			</div>
			<dl class="grid grid-cols-4 gap-2">
				{#each watch.readings as reading (reading.kind)}
					<div>
						<dt class="text-text-subtle text-[0.6875rem]">
							{RESOURCE_LABELS[reading.kind]}
						</dt>
						<dd
							class="text-sm font-semibold tabular-nums {LEVEL_CLASSES[
								reading.level
							]}"
						>
							{reading.percent}%
						</dd>
					</div>
				{/each}
			</dl>
		</div>
	{/each}
	{#each unread as host (host.id)}
		<div class="panel rounded-md p-4">
			<div class="mb-2 flex items-center gap-2">
				<Server class="text-text-subtle size-4" />
				<span class="text-text truncate text-sm font-medium">{host.name}</span>
			</div>
			<p class="text-text-muted text-xs">
				{host.measured
					? "No reading yet: its agent hasn't answered in the last few minutes."
					: "Not measured: a raw Docker connection has no agent to read the machine with."}
			</p>
		</div>
	{/each}
</div>
