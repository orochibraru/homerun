<script lang="ts">
	import { onMount } from "svelte";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { formatBytes } from "$lib/formatting";
	import { getReplicaStats } from "$lib/remote/stats.remote";

	const POLL_MS = 5000;

	const { serviceId }: { serviceId: string } = $props();

	const replicas = $derived(getReplicaStats(serviceId));

	onMount(() => {
		const timer = setInterval(() => {
			void replicas.refresh();
		}, POLL_MS);
		return () => clearInterval(timer);
	});

	function stateClass(state: string): string {
		if (state === "running") {
			return "bg-emerald-500";
		}
		if (state === "failed" || state === "rejected") {
			return "bg-red-500";
		}
		return "bg-amber-500";
	}
</script>

<section class="panel mb-4 rounded-xl">
  <div class="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
    <h2 class="eyebrow">Replicas</h2>
    <span class="text-text-subtle text-[0.6875rem]">
      Live · usage only for replicas on this host
    </span>
  </div>

  {#if replicas.error}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      Couldn't load this service's replicas.
    </p>
  {:else if !replicas.ready}
    <div class="space-y-2 p-4">
      {#each [0, 1] as row (row)}
        <Skeleton class="h-6 w-full" />
      {/each}
    </div>
  {:else if replicas.current.length === 0}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      No replicas are scheduled right now.
    </p>
  {:else}
    <div class="overflow-x-auto">
      <table class="w-full text-left">
        <thead>
          <tr class="border-border text-text-muted border-b text-[0.6875rem] font-medium">
            <th class="px-4 py-2" scope="col">Replica</th>
            <th class="px-4 py-2" scope="col">Node</th>
            <th class="px-4 py-2" scope="col">State</th>
            <th class="px-4 py-2 text-right" scope="col">CPU</th>
            <th class="px-4 py-2 text-right" scope="col">Memory</th>
            <th class="px-4 py-2 text-right" scope="col">Traffic</th>
          </tr>
        </thead>
        <tbody class="divide-border divide-y">
          {#each replicas.current as replica (replica.taskId)}
            <tr class="text-sm">
              <td class="text-text px-4 py-2 font-mono text-xs">
                #{replica.slot ?? "?"}
                <span class="text-text-subtle">{replica.taskId.slice(0, 12)}</span>
              </td>
              <td class="text-text-muted px-4 py-2 text-xs">
                {replica.node}{replica.local ? " (this host)" : ""}
              </td>
              <td class="px-4 py-2 text-xs">
                <span class="inline-flex items-center gap-1.5">
                  <span class="size-1.5 rounded-full {stateClass(replica.state)}"></span>
                  <span class="text-text">{replica.state}</span>
                </span>
                {#if replica.error}
                  <p class="text-text-subtle mt-0.5 text-[0.6875rem]">{replica.error}</p>
                {/if}
              </td>
              {#if replica.sample}
                <td class="tabular-nums text-text px-4 py-2 text-right text-xs">
                  {replica.sample.cpuPercent.toFixed(1)}%
                </td>
                <td class="tabular-nums text-text px-4 py-2 text-right text-xs">
                  {formatBytes(replica.sample.memUsedMb * 1024 * 1024)}
                </td>
                <td class="tabular-nums text-text-muted px-4 py-2 text-right text-xs">
                  {formatBytes(replica.sample.netRxBytes + replica.sample.netTxBytes)}
                </td>
              {:else}
                <td class="text-text-subtle px-4 py-2 text-right text-xs" colspan="3">
                  {replica.local ? "Not running" : "On another node"}
                </td>
              {/if}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
