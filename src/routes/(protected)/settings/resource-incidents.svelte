<script lang="ts">
	import { formatDuration } from "#lib/resource-incidents.js";
	import { RESOURCE_LABELS } from "#lib/resource-thresholds.js";
	import type { ResourceIncident } from "#lib/server/db/schema.js";

	interface Props {
		incidents: ResourceIncident[];
	}

	const { incidents }: Props = $props();
</script>

<div class="border-border border-t p-5">
  <h3 class="text-text mb-2 text-sm font-semibold">Recent incidents</h3>
  {#if incidents.length === 0}
    <p class="text-text-muted text-xs">None yet: no resource has stayed past its limit.</p>
  {:else}
    <ul class="divide-border border-border divide-y rounded-md border text-sm">
      {#each incidents as incident (incident.id)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-0.5 px-3 py-2">
          <span class="text-text font-medium">{RESOURCE_LABELS[incident.kind]}</span>
          <span
            class="rounded-md px-1.5 py-0.5 text-[0.6875rem] font-medium {incident.level === 'hard'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400'}"
          >
            {incident.level === "hard" ? "Hard limit" : "Soft limit"}
          </span>
          <span class="text-text-muted text-xs">peak {incident.peakPercent}%</span>
          <span class="text-text-subtle ml-auto text-xs">
            {new Date(incident.startedAt).toLocaleString()} ·
            {incident.resolvedAt
              ? `lasted ${formatDuration(new Date(incident.resolvedAt).getTime() - new Date(incident.startedAt).getTime())}`
              : "ongoing"}
            · {incident.notifications} {incident.notifications === 1 ? "alert" : "alerts"}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</div>
