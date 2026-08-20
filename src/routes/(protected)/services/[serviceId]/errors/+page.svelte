<script lang="ts">
  import { AlertTriangle, ChevronDown } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { resolve } from "$app/paths";
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

<section class="rounded-2xl border border-border bg-surface">
  <div class="flex items-center gap-2 border-b border-border px-5 py-4">
    <AlertTriangle class="size-4 text-text-muted" />
    <h2 class="text-sm font-semibold text-text">
      Failed deployments
      {#if data.failedDeployments.length > 0}
        <span class="ml-1 text-xs font-normal text-text-muted"
          >({data.failedDeployments.length})</span
        >
      {/if}
    </h2>
  </div>

  {#if data.failedDeployments.length === 0}
    <div class="flex flex-col items-center justify-center py-12 text-center">
      <p class="text-sm font-medium text-text-muted">No deploy failures 🎉</p>
    </div>
  {:else}
    <div class="divide-y divide-border">
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
              <p class="truncate text-xs text-text-muted">
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
                class="size-4 shrink-0 text-text-muted transition-transform {expandedDeploymentId ===
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
                <div class="break-all whitespace-pre-wrap">{line}</div>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>
