<script lang="ts">
	import { ChevronRight } from "@lucide/svelte";
	import { invalidateAll } from "$app/navigation";
	import DeployLogPanel from "$lib/components/deploy-log-panel.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import RunStatusBadge from "$lib/components/run-status-badge.svelte";

	interface Run {
		error: string | null;
		id: string;
		key: string | null;
		kind: string;
		log: string;
		startedAt: Date;
		success: boolean | null;
	}

	interface Props {
		runs: Run[];
	}

	const { runs }: Props = $props();

	let expandedRunId = $state<string | null>(null);

	function toggleRun(id: string) {
		expandedRunId = expandedRunId === id ? null : id;
	}

	$effect(() => {
		if (!runs.some((run) => run.success === null)) {
			return;
		}
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});
</script>

<section class="rounded-md panel">
  <PanelHeader title="Run log" />
  <div class="overflow-x-auto">
    <table class="w-full text-sm">
      <thead>
        <tr class="border-b border-border text-left text-xs uppercase text-text-muted">
          <th class="px-5 py-3 font-medium">Started</th>
          <th class="px-5 py-3 font-medium">Kind</th>
          <th class="px-5 py-3 font-medium">Status</th>
        </tr>
      </thead>
      <tbody>
        {#each runs as run (run.id)}
          <tr
            class="cursor-pointer border-b border-border/60 last:border-0 hover:bg-surface-2"
            onclick={() => toggleRun(run.id)}
          >
            <td class="px-5 py-3 whitespace-nowrap text-text-muted">
              <button
                class="flex items-center gap-1.5 text-left"
                aria-expanded={expandedRunId === run.id}
                onclick={(event) => {
                  event.stopPropagation();
                  toggleRun(run.id);
                }}
                type="button"
              >
                <ChevronRight
                  class="size-3.5 shrink-0 text-text-subtle transition-transform {expandedRunId ===
                  run.id
                    ? 'rotate-90'
                    : ''}"
                />
                {new Date(run.startedAt).toLocaleString()}
              </button>
            </td>
            <td class="px-5 py-3 text-text-muted" title={run.key ?? ""}>
              {run.kind === "restore" ? "Restore" : "Backup"}
            </td>
            <td class="px-5 py-3">
              <RunStatusBadge error={run.error} success={run.success} />
            </td>
          </tr>
          {#if expandedRunId === run.id}
            <tr class="border-b border-border/60 last:border-0">
              <td class="pt-3" colspan="3">
                {#if run.log || run.error}
                  <DeployLogPanel
                    errorMessage={run.error}
                    log={run.log}
                    logName="{run.kind} log"
                  />
                {:else}
                  <p class="px-5 pb-3 text-xs text-text-muted">
                    {run.success === null
                      ? "Waiting for the first line…"
                      : "This run has no log: it ran before runs kept one."}
                  </p>
                {/if}
              </td>
            </tr>
          {/if}
        {/each}
      </tbody>
    </table>
  </div>
</section>
