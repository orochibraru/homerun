<script lang="ts">
	import { CircleCheck, CircleX, Globe, Network } from "@lucide/svelte";
	import { timeAgo } from "$lib/formatting";

	interface Check {
		checkedAt: Date;
		detail: string | null;
		kind: "internal" | "external";
		latencyMs: number | null;
		ok: boolean;
		target: string | null;
	}

	const { checks, enabled }: { checks: Check[]; enabled: boolean } = $props();

	const internal = $derived(checks.find((c) => c.kind === "internal"));
	const external = $derived(checks.find((c) => c.kind === "external"));

	/** What to actually try, per probe, when it's failing. */
	const HINTS: Record<"internal" | "external", string[]> = {
		external: [
			"Check the hostname's DNS actually points at this host (or at your tunnel).",
			"Traefik only picks up routing labels on deploy : redeploy after changing the domain or the login wall.",
			"A certificate that hasn't been issued yet answers as a TLS failure : check Traefik's logs under System Logs.",
			"Behind Pangolin, the Target must point at this host's 443 over https, not 80.",
		],
		internal: [
			"The container is running but its port isn't answering : check the app's own logs above.",
			"Confirm the container port on the Networking tab matches what the app listens on.",
			"An app bound to 127.0.0.1 inside its container is unreachable from the network : bind 0.0.0.0.",
		],
	};
</script>

{#snippet probe(
  label: string,
  Icon: typeof Globe,
  check: Check | undefined,
  kind: "internal" | "external",
)}
  <div class="px-4 py-3">
    <div class="flex items-center gap-2">
      <Icon class="text-text-subtle size-3.5 shrink-0" />
      <span class="text-text text-sm font-medium">{label}</span>
      {#if check}
        <span
          class="ml-auto flex items-center gap-1 text-xs {check.ok
          ? 'text-emerald-600 dark:text-emerald-400'
          : 'text-red-500'}"
        >
          {#if check.ok}
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
    {#if check}
      <p class="text-text-subtle mt-1 truncate text-xs">
        {check.target ?? ""}
        {#if check.detail}
          · {check.detail}
        {/if}
        {#if check.latencyMs !== null && check.ok}
          · {check.latencyMs}ms
        {/if}
        · {timeAgo(check.checkedAt)}
      </p>
      {#if !check.ok}
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
    <span class="text-text-subtle text-[0.6875rem]">Probed every minute</span>
  </div>
  {#if !enabled}
    <p class="text-text-muted px-4 py-6 text-center text-xs">
      Uptime probing is off for this service.
    </p>
  {:else}
    <div class="divide-border divide-y">
      {@render probe("From the network", Network, internal, "internal")}
      {@render probe("From its hostname", Globe, external, "external")}
    </div>
  {/if}
</section>
