<script lang="ts">
	import { AlertTriangle, ChevronDown } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import AnsiLine from "$lib/components/ansi-line.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Errors`));

	let expandedDeploymentId = $state<string | null>(null);
</script>

{#if data.service.currentStatus === "failed"}
  <div
    class="mb-6 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400"
  >
    <AlertTriangle class="mt-0.5 size-4 shrink-0" />
    <div>
      <p class="font-medium">This service's container is currently down.</p>
      <p class="mt-0.5 text-xs opacity-80">
        Check its
        <a
          class="underline"
          href={resolve("/(protected)/services/[serviceId]/logs", {
            serviceId: data.service.id,
          })}
          >Logs</a
        >
        tab for the crash output.
      </p>
    </div>
  </div>
{/if}

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border flex items-center gap-2 border-b px-5 py-4">
    <AlertTriangle class="text-text-muted size-4" />
    <h2 class="text-text text-sm font-semibold">
      Failed deployments
      {#if data.failedDeployments.length > 0}
        <span class="text-text-muted ml-1 text-xs font-normal"
          >({data.failedDeployments.length})</span
        >
      {/if}
    </h2>
  </div>

  {#if data.failedDeployments.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <p class="text-text-muted text-sm font-medium">No deploy failures 🎉</p>
    </div>
  {:else}
    <div class="divide-border divide-y">
      {#each data.failedDeployments as dep (dep.id)}
        <div>
          <button
            class="flex w-full items-center gap-4 px-5 py-3 text-left"
            onclick={() => {
              expandedDeploymentId =
                expandedDeploymentId === dep.id ? null : dep.id;
            }}
            type="button"
          >
            <div class="min-w-0 flex-1">
              <p class="text-text-muted truncate text-xs">
                {timeAgo(dep.createdAt)}
              </p>
              {#if dep.errorMessage}
                <p class="mt-0.5 truncate text-xs text-red-500">
                  {dep.errorMessage}
                </p>
              {/if}
            </div>
            {#if dep.log}
              <ChevronDown
                class="text-text-muted size-4 shrink-0 transition-transform {expandedDeploymentId ===
                dep.id
                  ? 'rotate-180'
                  : ''}"
              />
            {/if}
          </button>
          {#if expandedDeploymentId === dep.id && dep.log}
            <div
              class="mx-5 mb-3 max-h-64 overflow-y-auto rounded-xl bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-300"
            >
              {#each dep.log.split("\n").filter(Boolean) as line, i (i)}
                <AnsiLine {line} />
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

<!--
  App-level warn/error logs attributed to this service (see schema.ts's
  `appLog` docstring for how the attribution works) : not just deployment
  failures, a lightweight Sentry-adjacent view of "things this service's
  own code logged as wrong" (a failed Docker call, a rejected reconcile,
  etc.), independent of whether a deploy was even in flight when it happened.
-->
<section class="border-border bg-surface mt-6 rounded-2xl border">
  <div class="border-border flex items-center gap-2 border-b px-5 py-4">
    <AlertTriangle class="text-text-muted size-4" />
    <h2 class="text-text text-sm font-semibold">
      Application errors
      {#if data.appLogs.length > 0}
        <span class="text-text-muted ml-1 text-xs font-normal"
          >({data.appLogs.length})</span
        >
      {/if}
    </h2>
  </div>

  {#if data.appLogs.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <p class="text-text-muted text-sm font-medium">
        No app-level errors logged for this service 🎉
      </p>
    </div>
  {:else}
    <div class="divide-border divide-y">
      {#each data.appLogs as log (log.id)}
        <div class="px-5 py-3">
          <div class="flex items-center gap-2">
            <span
              class="rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase {log.level ===
              'error'
                ? 'bg-red-500/10 text-red-500'
                : 'bg-yellow-500/10 text-yellow-600'}"
            >
              {log.level}
            </span>
            {#if log.scope}
              <span class="text-text-muted text-xs font-medium">{log.scope}</span>
            {/if}
            <span class="text-text-subtle text-xs">{timeAgo(log.createdAt)}</span>
          </div>
          <p class="text-text mt-1 font-mono text-xs break-all">{log.message}</p>
        </div>
      {/each}
    </div>
  {/if}
</section>
