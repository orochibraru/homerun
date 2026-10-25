<script lang="ts">
	import { AlertTriangle } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { timeAgo } from "#lib/formatting.js";
	import { title } from "#lib/store/title.js";
	import ClearErrorsForm from "../clear-errors-form.svelte";
	import DismissedErrorsBar from "../dismissed-errors-bar.svelte";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Application errors`));
</script>

<DismissedErrorsBar dismissal={data.dismissal} serviceId={data.service.id} />

<section class="panel rounded-md">
  <div class="border-border flex items-center gap-2 border-b px-5 py-4">
    <AlertTriangle class="text-text-muted size-4" />
    <h2 class="eyebrow">
      Application errors
      {#if data.appLogs.length > 0}
        <span class="text-text-muted ml-1 text-xs font-normal"
        >({data.appLogs.length})</span>
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
              class="
                rounded px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase {log.level ===
                'error'
                ? 'bg-red-500/10 text-red-500'
                : 'bg-yellow-500/10 text-yellow-600'}
              "
            >
              {log.level}
            </span>
            {#if log.scope}
              <span class="text-text-muted text-xs font-medium">{
                log.scope
              }</span>
            {/if}
            <span class="text-text-subtle text-xs">{
              timeAgo(log.createdAt)
            }</span>
          </div>
          <p class="text-text mt-1 font-mono text-xs break-all">
            {log.message}
          </p>
        </div>
      {/each}
    </div>
  {/if}
</section>

{#if data.appLogs.length > 0}
  <ClearErrorsForm />
{/if}
