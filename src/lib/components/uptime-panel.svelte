<script lang="ts">
	import {
		CircleCheck,
		CircleX,
		Globe,
		MinusCircle,
		Network,
	} from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import HeartbeatStrip from "$lib/components/heartbeat-strip.svelte";
	import { timeAgo } from "$lib/formatting";

	interface Beat {
		checkedAt: Date;
		detail: string | null;
		id: string;
		latencyMs: number | null;
		ok: boolean;
		target: string | null;
	}

	interface Props {
		beats: { external: Beat[]; internal: Beat[] };
		enabled: boolean;
		/** Why the external probe is skipped, when it is. */
		externalSkipped?: string | null;
		/** Rendered at the end of the panel header, e.g. the on/off toggle. */
		headerAction?: Snippet;
	}

	const {
		beats,
		enabled,
		externalSkipped = null,
		headerAction,
	}: Props = $props();

	/** What to actually try, per probe, when it's failing. */
	const HINTS: Record<"internal" | "external", string[]> = {
		external: [
			"Check the hostname's DNS actually points at this host (or at your tunnel).",
			"Traefik only picks up routing labels on deploy : redeploy after changing the domain or the login wall.",
			"A certificate that hasn't been issued yet answers as a TLS failure : check Traefik's logs under System Logs.",
			"Behind Pangolin, the Target must point at this host's 443 over https, not 80.",
		],
		internal: [
			"The container is running but its port isn't answering : check the app's own logs below.",
			"Confirm the container port on the Networking tab matches what the app listens on.",
			"An app bound to 127.0.0.1 inside its container is unreachable from the network : bind 0.0.0.0.",
		],
	};

	function uptimePercent(series: Beat[]): number | null {
		if (series.length === 0) {
			return null;
		}
		return (series.filter((beat) => beat.ok).length / series.length) * 100;
	}
</script>

{#snippet heartbeat(series: Beat[])}
  <HeartbeatStrip beats={series} class="mt-2" />
{/snippet}

{#snippet probe(
  label: string,
  Icon: typeof Globe,
  series: Beat[],
  kind: "internal" | "external",
  skipped: string | null,
)}
  {@const latest = series.at(-1)}
  {@const percent = uptimePercent(series)}
  <div class="px-4 py-3">
    <div class="flex items-center gap-2">
      <Icon class="text-text-subtle size-3.5 shrink-0" />
      <span class="text-text text-sm font-medium">{label}</span>
      {#if skipped}
        <span class="text-text-subtle ml-auto flex items-center gap-1 text-xs">
          <MinusCircle class="size-3.5" />
          Not checked
        </span>
      {:else if latest}
        <span
          class="ml-auto flex items-center gap-1 text-xs {latest.ok
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-500'}"
        >
          {#if latest.ok}
            <CircleCheck class="size-3.5" />
            Responding
          {:else}
            <CircleX class="size-3.5" />
            Not responding
          {/if}
        </span>
      {:else}
        <span class="text-text-subtle ml-auto text-xs">Not checked yet</span>
      {/if}
    </div>

    {#if skipped}
      <p class="text-text-subtle mt-1 text-xs">{skipped}</p>
    {:else}
      {@render heartbeat(series)}
      <p class="text-text-subtle mt-1.5 truncate text-xs">
        {#if percent !== null}
          {percent.toFixed(0)}% over the last {series.length}
          {series.length === 1 ? "check" : "checks"}
        {/if}
        {#if latest}
          · {latest.target ?? ""}
          {#if latest.detail}
            · {latest.detail}
          {/if}
          {#if latest.latencyMs !== null && latest.ok}
            · {latest.latencyMs}ms
          {/if}
          · {timeAgo(latest.checkedAt)}
        {/if}
      </p>
      {#if latest && !latest.ok}
        <ul class="text-text-muted mt-2 space-y-1 text-xs">
          {#each HINTS[kind] as hint (hint)}
            <li class="flex gap-1.5">
              <span class="text-text-subtle">→</span>
              {hint}
            </li>
          {/each}
        </ul>
      {/if}
    {/if}
  </div>
{/snippet}

<section class="panel rounded-xl">
  <div class="panel-head">
    <h2 class="eyebrow">Uptime</h2>
    <div class="flex items-center gap-3">
      <span class="text-text-subtle text-[0.6875rem]">
        {enabled ? "Probed every minute" : "Paused"}
      </span>
      {@render headerAction?.()}
    </div>
  </div>
  {#if enabled}
    <div class="divide-border divide-y">
      {@render probe("From the network", Network, beats.internal, "internal", null)}
      {@render probe(
        "From its hostname",
        Globe,
        beats.external,
        "external",
        externalSkipped,
      )}
    </div>
  {:else}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      Uptime probing is off for this service.
    </p>
  {/if}
</section>
