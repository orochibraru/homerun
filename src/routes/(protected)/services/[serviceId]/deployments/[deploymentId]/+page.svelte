<script lang="ts">
	import { ArrowLeft } from "@lucide/svelte";
	import { onMount } from "svelte";
	import DeployLogPanel from "#lib/components/deploy-log-panel.svelte";
	import EnvironmentBadge from "#lib/components/environment-badge.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import { historyTriggerLabel } from "#lib/deploy-trigger.js";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();
	const dep = $derived(data.deployment);
	const inFlight = $derived(
		["pending", "pulling", "starting"].includes(dep.status),
	);

	onMount(() => title.set(`${data.service.name} · Deployment`));

	$effect(() => {
		if (!inFlight) {
			return;
		}
		const timer = setInterval(() => refreshAll(), 3000);
		return () => clearInterval(timer);
	});
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("deployments")}
  >
    <ArrowLeft class="size-4" />
    All deployments
  </a>

  <section class="panel rounded-md">
    <div class="border-border flex flex-wrap items-center gap-3 border-b px-5 py-4">
      <h2 class="eyebrow">Deployment</h2>
      <StatusBadge status={dep.status} />
      <EnvironmentBadge environment={dep.environment} />
      {#if dep.status === "running"}
        <a
          class="text-accent ml-auto text-xs hover:underline"
          href={resolve(
            "/(protected)/services/[serviceId]/environments/revisions/[revisionId]",
            { revisionId: dep.id, serviceId: data.service.id },
          )}
        >
          Open its revision
        </a>
      {/if}
    </div>
    <dl class="grid gap-x-6 gap-y-3 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
      <div>
        <dt class="text-text-subtle text-xs">Started</dt>
        <dd title={new Date(dep.startedAt).toLocaleString()}>
          {timeAgo(dep.startedAt)}
        </dd>
      </div>
      <div>
        <dt class="text-text-subtle text-xs">Took</dt>
        <dd class="tabular-nums">{dep.duration ?? "—"}</dd>
      </div>
      <div>
        <dt class="text-text-subtle text-xs">Trigger</dt>
        <dd>{historyTriggerLabel(dep.trigger)}</dd>
      </div>
      <div>
        <dt class="text-text-subtle text-xs">Source</dt>
        <dd class="font-mono text-xs break-all">
          {#if dep.gitCommit}
            {dep.gitRef ? `${dep.gitRef} @ ` : ""}{dep.gitCommit.slice(0, 7)}
          {:else}
            {dep.imageRef ?? "—"}
          {/if}
        </dd>
      </div>
    </dl>
    <div class="border-border border-t pt-3">
      {#if dep.log || dep.errorMessage}
        <DeployLogPanel
          errorMessage={dep.errorMessage}
          log={dep.log}
          logName="deploy log"
        />
      {:else}
        <p class="text-text-muted px-5 pb-3 text-xs">Waiting for the first line…</p>
      {/if}
    </div>
  </section>
</div>
