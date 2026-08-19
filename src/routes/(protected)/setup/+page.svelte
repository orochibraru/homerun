<script lang="ts">
  import { AlertTriangle, CheckCircle2, XCircle } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { title } from "$lib/store/title";

  const { data } = $props();

  onMount(() => title.set("Setup"));

  const severityStyle = {
    danger:
      "border-red-200 bg-red-50 dark:border-red-900/40 dark:bg-red-950/20",
    ok: "border-border bg-surface",
    warn: "border-amber-200 bg-amber-50 dark:border-amber-900/40 dark:bg-amber-950/20",
  } as const;
</script>

<div class="p-6 md:p-8">
  <div class="mb-6">
    <h1 class="text-2xl font-bold text-text">Setup</h1>
    <p class="mt-1 text-sm text-text-muted">
      Diagnostics for this instance's configuration — every field here is set
      via environment variables (see the README), not editable from this page.
    </p>
  </div>

  <div class="space-y-3">
    {#each data.checks as check (check.id)}
      <div
        class="flex items-start gap-3 rounded-2xl border p-4 {severityStyle[
          check.severity
        ]}"
      >
        {#if check.severity === "ok"}
          <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-emerald-600" />
        {:else if check.severity === "warn"}
          <AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-600" />
        {:else}
          <XCircle class="mt-0.5 size-4 shrink-0 text-red-600" />
        {/if}
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-text">{check.label}</p>
          <p class="mt-0.5 text-xs text-text-muted">{check.detail}</p>
          {#if check.envVar}
            <p class="mt-1 font-mono text-xs text-text-subtle">
              {check.envVar}
            </p>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>
