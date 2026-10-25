<script lang="ts">
	import { AlertTriangle, ChevronDown } from "@lucide/svelte";
	import { onMount } from "svelte";
	import DeployLogPanel from "#lib/components/deploy-log-panel.svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import ClearErrorsForm from "../clear-errors-form.svelte";
	import DismissedErrorsBar from "../dismissed-errors-bar.svelte";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Failed deployments`));

	let expandedDeploymentId = $state<string | null>(null);
</script>

<DismissedErrorsBar dismissal={data.dismissal} serviceId={data.service.id} />

<section class="panel rounded-md">
  <div class="border-border flex items-center gap-2 border-b px-5 py-4">
    <AlertTriangle class="text-text-muted size-4" />
    <h2 class="eyebrow">
      Failed deployments
      {#if data.failedDeployments.length > 0}
        <span class="text-text-muted ml-1 text-xs font-normal"
        >({data.failedDeployments.length})</span>
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
              expandedDeploymentId = expandedDeploymentId === dep.id ? null : dep.id;
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
                class="
                  text-text-muted size-4 shrink-0 transition-transform {expandedDeploymentId ===
                  dep.id
                  ? 'rotate-180'
                  : ''}
                "
              />
            {/if}
          </button>
          {#if expandedDeploymentId === dep.id && dep.log}
            <DeployLogPanel errorMessage={dep.errorMessage} log={dep.log} />
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</section>

{#if data.failedDeployments.length > 0}
  <ClearErrorsForm />
{/if}
