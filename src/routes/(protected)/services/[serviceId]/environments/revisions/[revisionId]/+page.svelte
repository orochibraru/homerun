<script lang="ts">
	import { ArrowLeft, History, RotateCcw, ScrollText } from "@lucide/svelte";
	import { onMount } from "svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import DeployLogPanel from "#lib/components/deploy-log-panel.svelte";
	import EnvironmentBadge from "#lib/components/environment-badge.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import StatusBadge from "#lib/components/status-badge.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { historyTriggerLabel } from "#lib/deploy-trigger.js";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const { data } = $props();
	const service = $derived(data.service);
	const revision = $derived(data.revision);
	const imageRef = $derived(
		revision.imageRef ?? `${service.image}:${service.tag}`,
	);

	onMount(() => title.set(`${data.service.name} · Revision`));

	let confirmOpen = $state(false);
	let revisionForm = $state<HTMLFormElement | null>(null);
	let deploying = $state(false);
	let restoreConfig = $state(false);

	const HEALTH_LABELS = {
		healthy: {
			class: "border-emerald-500/30 text-emerald-600",
			label: "Healthy",
		},
		rolled_back: {
			class: "border-red-500/30 text-red-600",
			label: "Rolled back",
		},
		unhealthy: { class: "border-red-500/30 text-red-600", label: "Unhealthy" },
		watching: {
			class: "border-amber-500/30 text-amber-600",
			label: "Checking health",
		},
	};

	function took(
		startedAt: Date | null,
		finishedAt: Date | null,
	): string | null {
		if (!(startedAt && finishedAt)) {
			return null;
		}
		const seconds = Math.round(
			(new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 1000,
		);
		return `${Math.max(1, seconds)}s`;
	}

	const commitHref = $derived.by(() => {
		const url = service.gitUrl;
		if (!(revision.gitCommit && url?.startsWith("http"))) {
			return null;
		}
		return `${url.replace(/\.git$/, "").replace(/\/$/, "")}/commit/${revision.gitCommit}`;
	});

	const facts = $derived([
		["Deployed", timeAgo(revision.createdAt)],
		[
			"Last deployed",
			revision.lastDeployedAt ? timeAgo(revision.lastDeployedAt) : "-",
		],
		["Took", took(revision.startedAt, revision.finishedAt) ?? "-"],
		["Redeploys", String(revision.redeployCount)],
		["Digest", revision.imageDigest ?? "-"],
		[
			"Image",
			revision.deployable
				? revision.retained
					? "Retained"
					: "Not retained"
				: "-",
		],
	]);
</script>

<div class="space-y-6">
  <div class="space-y-3">
    <a
      class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
      href={resolve("/(protected)/services/[serviceId]/environments/revisions", {
        serviceId: service.id,
      })}
    >
      <ArrowLeft class="size-3.5" />
      All revisions
    </a>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <StatusBadge status={revision.status} />
          <EnvironmentBadge environment={revision.environment} />
          {#if revision.current}
            <span class="border-accent/40 text-accent rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase">
              Current
            </span>
          {/if}
          {#if revision.health}
            <span class="rounded-sm border px-1.5 py-px text-[0.625rem] font-semibold tracking-[0.08em] uppercase {HEALTH_LABELS[revision.health].class}">
              {HEALTH_LABELS[revision.health].label}
            </span>
          {/if}
        </div>
        <h2 class="text-text font-mono text-base font-semibold break-all">{imageRef}</h2>
        {#if revision.gitCommit}
          <p class="text-text-muted font-mono text-xs break-all">
            {#if commitHref}
              <a class="text-accent underline" href={commitHref} rel="noreferrer" target="_blank">
                {revision.gitRef ? `${revision.gitRef}@` : ""}{revision.gitCommit.slice(0, 7)}
              </a>
            {:else}
              {revision.gitRef ? `${revision.gitRef}@` : ""}{revision.gitCommit.slice(0, 7)}
            {/if}
          </p>
        {/if}
      </div>
      {#if revision.deployable && !revision.current}
        <Button
          disabled={deploying}
          onclick={() => {
            restoreConfig = false;
            confirmOpen = true;
          }}
          size="sm"
          type="button"
          variant="outline"
        >
          <RotateCcw class="size-3.5" />
          Deploy this revision
        </Button>
      {/if}
    </div>
  </div>

  <dl class="panel grid grid-cols-2 gap-4 rounded-md p-4 sm:grid-cols-3 lg:grid-cols-6">
    {#each facts as [name, value] (name)}
      <div class="min-w-0">
        <dt class="text-text-subtle text-xs">{name}</dt>
        <dd class="text-text truncate font-mono text-sm" title={value}>{value}</dd>
      </div>
    {/each}
  </dl>

  {#if revision.healthReason}
    <p class="rounded-md border border-red-500/30 px-4 py-3 text-sm text-red-600">
      {revision.healthReason}
    </p>
  {/if}

  <section class="panel rounded-md">
    <PanelHeader
      description="The latest attempt's deploy log."
      icon={ScrollText}
      title="Log"
    />
    {#if revision.errorMessage}
      <p class="px-5 pt-3 text-xs text-red-500">{revision.errorMessage}</p>
    {/if}
    {#if revision.log}
      <div class="pt-3">
        <DeployLogPanel errorMessage={revision.errorMessage} log={revision.log} />
      </div>
    {:else}
      <p class="text-text-muted px-5 py-6 text-sm">No log recorded.</p>
    {/if}
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description="Every time this revision was deployed, newest first."
      icon={History}
      title="Deployments"
    />
    <ul class="divide-border divide-y">
      {#each data.deployments as deployment (deployment.id)}
        <li class="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-xs">
          <StatusBadge status={deployment.status} />
          <span class="text-text font-medium">
            {deployment.rollback ? "Rollback" : historyTriggerLabel(deployment.trigger)}
          </span>
          <span class="text-text-muted">{timeAgo(deployment.createdAt)}</span>
          {#if took(deployment.startedAt, deployment.finishedAt)}
            <span class="text-text-subtle">took {took(deployment.startedAt, deployment.finishedAt)}</span>
          {/if}
          {#if deployment.errorMessage}
            <span class="basis-full truncate text-red-500" title={deployment.errorMessage}>
              {deployment.errorMessage}
            </span>
          {/if}
        </li>
      {:else}
        <li class="text-text-muted px-5 py-6 text-sm">No deployments in the recent history.</li>
      {/each}
    </ul>
  </section>
</div>

<form
  action="?/deployRevision"
  class="hidden"
  method="POST"
  bind:this={revisionForm}
  use:enhance={enhanceToast({
    error: "Couldn't queue the revision.",
    loading: "Queueing the revision",
    onSuccess: async () => {
      await goto(
        resolve("/(protected)/services/[serviceId]", {
          serviceId: service.id,
        }),
      );
    },
    onSettled: () => {
      deploying = false;
    },
    onStart: () => {
      deploying = true;
    },
    success: "Rollback queued.",
  })}
>
  <input name="restoreConfig" type="hidden" value={restoreConfig ? "on" : ""}>
</form>

<ConfirmDialog
  bind:open={confirmOpen}
  confirmLabel="Deploy this revision"
  description={`Redeploys ${imageRef}${revision.gitCommit ? ` (commit ${revision.gitCommit.slice(0, 7)})` : ""} exactly as it ran, skipping the build and the image scan. Volumes are always kept as they are now.`}
  destructive={false}
  onConfirm={() => revisionForm?.requestSubmit()}
  title="Deploy this revision?"
>
  <CheckBox
    helperText={revision.hasConfigSnapshot
      ? "Put back the environment variables, CPU, memory, replicas, port, network mode and volumes this revision ran with. Off keeps the current ones."
      : "This revision was deployed before configs were recorded, so only its image can be restored."}
    id="restoreConfig"
    label="Also restore env vars, resources, networking and volumes"
    name="restoreConfigToggle"
    bind:checked={restoreConfig}
  />
</ConfirmDialog>
