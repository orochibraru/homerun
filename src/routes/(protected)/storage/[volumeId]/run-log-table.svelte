<script lang="ts">
	import PanelHeader from "$lib/components/panel-header.svelte";
	import RunStatusBadge from "$lib/components/run-status-badge.svelte";

	interface Run {
		error: string | null;
		id: string;
		key: string | null;
		kind: string;
		startedAt: Date;
		success: boolean | null;
	}

	interface Props {
		runs: Run[];
	}

	const { runs }: Props = $props();
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
          <tr class="border-b border-border/60 last:border-0">
            <td class="px-5 py-3 text-text-muted">
              {new Date(run.startedAt).toLocaleString()}
            </td>
            <td class="px-5 py-3 text-text-muted" title={run.key ?? ""}>
              {run.kind === "restore" ? "Restore" : "Backup"}
            </td>
            <td class="px-5 py-3">
              <RunStatusBadge error={run.error} success={run.success} />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
</section>
