<script lang="ts">
	import { CircleCheck, CircleX, MinusCircle } from "@lucide/svelte";
	import HeartbeatStrip from "$lib/components/heartbeat-strip.svelte";

	const { data } = $props();

	const allUp = $derived(
		data.services.length > 0 &&
			data.services.every((svc) => svc.status !== "down"),
	);
	const downCount = $derived(
		data.services.filter((svc) => svc.status === "down").length,
	);
</script>

<svelte:head>
  <title>{data.name} · Status</title>
  <meta content="noindex" name="robots" />
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-12 md:py-20">
  <header class="mb-10">
    <h1 class="text-text text-2xl font-semibold tracking-tight">{data.name}</h1>
    {#if data.description}
      <p class="text-text-muted mt-2 text-sm">{data.description}</p>
    {/if}
  </header>

  <div
    class="mb-8 flex items-center gap-3 rounded-md border p-4 {allUp
    ? 'border-emerald-500/30 bg-emerald-500/10'
    : 'border-red-500/30 bg-red-500/10'}"
  >
    {#if allUp}
      <CircleCheck class="size-5 shrink-0 text-emerald-500" />
      <p class="text-sm font-medium text-emerald-700 dark:text-emerald-400">
        All systems operational
      </p>
    {:else}
      <CircleX class="size-5 shrink-0 text-red-500" />
      <p class="text-sm font-medium text-red-700 dark:text-red-400">
        {downCount}
        {downCount === 1 ? "service is" : "services are"} down
      </p>
    {/if}
  </div>

  {#if data.services.length === 0}
    <p class="text-text-muted text-sm">
      Nothing is being tracked on this page yet.
    </p>
  {:else}
    <div class="panel divide-border divide-y rounded-md">
      {#each data.services as svc (svc.id)}
        <div class="flex items-center gap-4 px-5 py-4">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              {#if svc.status === "up"}
                <CircleCheck class="size-4 shrink-0 text-emerald-500" />
              {:else if svc.status === "down"}
                <CircleX class="size-4 shrink-0 text-red-500" />
              {:else}
                <MinusCircle class="text-text-subtle size-4 shrink-0" />
              {/if}
              <p class="text-text truncate text-sm font-medium">{svc.name}</p>
            </div>
            <HeartbeatStrip
              beats={svc.beats}
              class="mt-2"
              emptyLabel="No data yet."
              showDetail={false}
            />
          </div>
          <span class="text-text-muted shrink-0 text-xs tabular-nums">
            {svc.uptimePercent === null ? "—" : `${svc.uptimePercent}%`}
          </span>
        </div>
      {/each}
    </div>
  {/if}

  <footer class="text-text-subtle mt-10 text-xs">
    Updated {data.updatedAt.toLocaleString()}
  </footer>
</div>
