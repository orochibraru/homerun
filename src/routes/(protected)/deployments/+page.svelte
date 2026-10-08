<script lang="ts">
	import { History } from "@lucide/svelte";
	import { onMount } from "svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "#lib/components/entity-toolbar.svelte";
	import EnvironmentBadge from "#lib/components/environment-badge.svelte";
	import Pagination from "#lib/components/pagination.svelte";
	import Skeleton from "#lib/components/skeleton.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import { SERVICE_STATUS_CONFIG } from "#lib/constants.js";
	import {
		HISTORY_TRIGGERS,
		historyTriggerLabel,
	} from "#lib/deploy-trigger.js";
	import { timeAgo } from "#lib/formatting.js";
	import { environmentLabel } from "#lib/release-channels.js";
	import { title } from "#lib/store/title.js";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set("Deployments"));

	$effect(() => {
		let timer: ReturnType<typeof setInterval> | undefined;
		let cancelled = false;
		void data.listing.then((listing) => {
			if (
				!cancelled &&
				listing.deployments.some((dep) =>
					["pending", "pulling", "starting"].includes(dep.status),
				)
			) {
				timer = setInterval(() => refreshAll(), 3000);
			}
		});
		return () => {
			cancelled = true;
			clearInterval(timer);
		};
	});

	const filters: FilterGroup[] = $derived([
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
			options: data.environments.map((value) => ({
				label: environmentLabel(value),
				value,
			})),
		},
	]);
</script>

<div class="p-5 md:p-6">
  <div class="mb-8">
    <h1 class="text-text text-lg font-semibold tracking-tight">Deployments</h1>
    <p class="text-text-muted mt-1 text-sm">
      Every deploy and rollback across all services, newest first. Open one for
      its log.
    </p>
  </div>

  {#await data.listing}
    <div class="space-y-2">
      {#each { length: 8 }, i (i)}
        <Skeleton class="h-12 w-full" />
      {/each}
    </div>
  {:then listing}
  {#if listing.total === 0 && !data.filtered}
    <EmptyState
      icon={History}
      subtitle="Deploys and rollbacks of every service show up here."
      title="No deployments yet"
    />
  {:else}
    <EntityToolbar
      filters={filters}
      placeholder="Search by service, image, git ref, commit or error…"
    />

    {#if listing.deployments.length === 0}
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
            {#each listing.deployments as dep (dep.id)}
              <tr class="border-border/60 hover:bg-surface-2 border-b last:border-0">
                <td class="px-4 py-3">
                  <span class="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
                    <a
                      class="text-text hover:text-accent font-medium"
                      href={resolve(
                        "/(protected)/services/[serviceId]/environments/revisions/[revisionId]",
                        { revisionId: dep.id, serviceId: dep.serviceId },
                      )}
                    >
                      {dep.serviceName}
                    </a>
                    <EnvironmentBadge environment={dep.environment} />
                  </span>
                  <p class="text-text-muted mt-0.5 text-xs md:hidden">
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

                <td
                  class="text-text-muted hidden px-4 py-3 md:table-cell"
                >{dep.userName ?? "—"}</td>

                <td
                  class="text-text-muted hidden px-4 py-3 whitespace-nowrap md:table-cell"
                  title={new Date(dep.startedAt).toLocaleString()}
                >
                  {timeAgo(dep.startedAt)}
                </td>
                <td class="text-text-muted hidden px-4 py-3 tabular-nums md:table-cell">{dep.duration ?? "—"}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <Pagination
        label="deployments"
        page={listing.page}
        perPage={listing.perPage}
        total={listing.total}
      />
    {/if}
  {/if}
  {/await}
</div>
