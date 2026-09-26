<script lang="ts">
	import { ChevronRight, History } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import DeployLogPanel from "$lib/components/deploy-log-panel.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import EnvironmentBadge from "$lib/components/environment-badge.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { SERVICE_STATUS_CONFIG } from "$lib/constants";
	import { HISTORY_TRIGGERS, historyTriggerLabel } from "$lib/deploy-trigger";
	import { timeAgo } from "$lib/formatting";
	import { DEPLOY_ENVIRONMENTS, environmentLabel } from "$lib/release-channels";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Deployments"));

	let expandedId = $state<string | null>(null);

	function toggle(id: string) {
		expandedId = expandedId === id ? null : id;
	}

	$effect(() => {
		if (
			!data.deployments.some((dep) =>
				["pending", "pulling", "starting"].includes(dep.status),
			)
		) {
			return;
		}
		const timer = setInterval(() => invalidateAll(), 3000);
		return () => clearInterval(timer);
	});

	const filters: FilterGroup[] = [
		{
			key: "status",
			label: "Status",
			options: (
				[
					"running",
					"failed",
					"stopped",
					"pending",
					"pulling",
					"starting",
				] as const
			).map((value) => ({ label: SERVICE_STATUS_CONFIG[value].label, value })),
		},
		{
			key: "trigger",
			label: "Trigger",
			options: HISTORY_TRIGGERS.map((value) => ({
				label: historyTriggerLabel(value),
				value,
			})),
		},
		{
			key: "environment",
			label: "Environment",
			options: DEPLOY_ENVIRONMENTS.map((value) => ({
				label: environmentLabel(value),
				value,
			})),
		},
	];
</script>

<div class="p-5 md:p-6">
  <div class="mb-8">
    <h1 class="text-text text-lg font-semibold tracking-tight">Deployments</h1>
    <p class="text-text-muted mt-1 text-sm">
      Every deploy and rollback across all services, newest first. Click a row for
      its log.
    </p>
  </div>

  {#if data.total === 0 && !data.filtered}
    <EmptyState
      icon={History}
      subtitle="Deploys and rollbacks of every service show up here."
      title="No deployments yet"
    />
  {:else}
    <EntityToolbar
      {filters}
      placeholder="Search by service, image, git ref, commit or error…"
    />

    {#if data.deployments.length === 0}
      <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
        <p class="text-text-muted text-sm">No deployments match your filters.</p>
      </div>
    {:else}
      <div class="panel overflow-x-auto rounded-md">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Service</th>
              <th class="px-4 py-3 font-medium">Status</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Trigger</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Source</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">By</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Started</th>
              <th class="hidden px-4 py-3 font-medium md:table-cell">Duration</th>
            </tr>
          </thead>
          <tbody>
            {#each data.deployments as dep (dep.id)}
              <tr
                class="border-border/60 hover:bg-surface-2 cursor-pointer border-b last:border-0"
                onclick={() => toggle(dep.id)}
              >
                <td class="px-4 py-3">
                  <div class="flex items-center gap-1.5">
                    <button
                      class="text-text-subtle"
                      aria-expanded={expandedId === dep.id}
                      aria-label="Toggle the log of this deployment"
                      onclick={(event) => {
                        event.stopPropagation();
                        toggle(dep.id);
                      }}
                      type="button"
                    >
                      <ChevronRight
                        class="size-3.5 shrink-0 transition-transform {expandedId === dep.id
                          ? 'rotate-90'
                          : ''}"
                      />
                    </button>
                    <a
                      class="text-text hover:text-accent font-medium"
                      href="{resolve('/services')}/{dep.serviceId}/revisions?deployment={dep.id}"
                      onclick={(event) => event.stopPropagation()}
                    >
                      {dep.serviceName}
                    </a>
                    <EnvironmentBadge environment={dep.environment} />
                  </div>
                  <p class="text-text-muted mt-0.5 pl-5 text-xs md:hidden">
                    {timeAgo(dep.startedAt)} · {historyTriggerLabel(dep.trigger)}{dep.userName ? ` · ${dep.userName}` : ""}{dep.duration ? ` · ${dep.duration}` : ""}
                  </p>
                  {#if dep.status === "failed" && dep.errorMessage}
                    <p class="mt-1 line-clamp-2 max-w-md text-xs text-red-500 md:line-clamp-1" title={dep.errorMessage}>
                      {dep.errorMessage}
                    </p>
                  {/if}
                </td>
                <td class="px-4 py-3"><StatusBadge status={dep.status} /></td>
                <td class="text-text-muted hidden px-4 py-3 md:table-cell">{historyTriggerLabel(dep.trigger)}</td>
                <td class="text-text-muted hidden px-4 py-3 font-mono text-xs md:table-cell">
                  {#if dep.gitCommit}
                    <span title={dep.gitRef ?? ""}>
                      {dep.gitRef ? `${dep.gitRef} @ ` : ""}{dep.gitCommit.slice(0, 7)}
                    </span>
                  {:else}
                    {dep.imageRef ?? "—"}
                  {/if}
                </td>
                <td class="text-text-muted hidden px-4 py-3 md:table-cell">{dep.userName ?? "—"}</td>
                <td
                  class="text-text-muted hidden px-4 py-3 whitespace-nowrap md:table-cell"
                  title={new Date(dep.startedAt).toLocaleString()}
                >
                  {timeAgo(dep.startedAt)}
                </td>
                <td class="text-text-muted hidden px-4 py-3 tabular-nums md:table-cell">{dep.duration ?? "—"}</td>
              </tr>
              {#if expandedId === dep.id}
                <tr class="border-border/60 border-b last:border-0">
                  <td class="pt-3" colspan="7">
                    {#if dep.log || dep.errorMessage}
                      <DeployLogPanel errorMessage={dep.errorMessage} log={dep.log} logName="deploy log" />
                    {:else}
                      <p class="text-text-muted px-5 pb-3 text-xs">Waiting for the first line…</p>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
      <Pagination
        label="deployments"
        page={data.page}
        perPage={data.perPage}
        total={data.total}
      />
    {/if}
  {/if}
</div>
