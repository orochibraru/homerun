<script lang="ts">
	import { Check, Minus } from "@lucide/svelte";
	import AsyncBlock from "$lib/components/async-block.svelte";
	import {
		errorClass,
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { getSwarmReadiness } from "$lib/remote/setup.remote";
	import StepPanel from "./step-panel.svelte";
	import type { OnboardingWizard } from "./wizard-state.svelte";

	interface Props {
		hidden: boolean;
		showError: (field: string) => string | undefined;
		wizard: OnboardingWizard;
	}

	const { hidden, showError, wizard }: Props = $props();

	const swarm = getSwarmReadiness();
</script>

{#snippet swarmCheck(ok: boolean, yes: string, no: string)}
  <li class="flex items-start gap-2">
    {#if ok}
      <Check class="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
      <span>{yes}</span>
    {:else}
      <Minus class="text-text-subtle mt-0.5 size-3.5 shrink-0" />
      <span>{no}</span>
    {/if}
  </li>
{/snippet}

<StepPanel
  description="How Homerun reaches the daemon it deploys onto."
  {hidden}
  title="Docker"
>
  <div>
    <label class={label} for="dockerSocketPath">Socket path</label>
    <input
      class="{input}"
      id="dockerSocketPath"
      name="dockerSocketPath"
      placeholder={wizard.envDefaults?.dockerSocketPath}
      type="text"
      bind:value={wizard.dockerSocketPath}
    >
    <p class="mt-1.5 text-xs text-text-subtle">
      Leave blank to keep auto-detecting this (shown above as a
      placeholder) : only set it here to pin a specific path.
    </p>
    {#if showError("dockerSocketPath")}
      <p class={errorClass}>{showError("dockerSocketPath")}</p>
    {/if}
  </div>
  <div>
    <label class={label} for="dockerNetworkName"
    >Shared network name</label>
    <input
      class="{input}"
      id="dockerNetworkName"
      name="dockerNetworkName"
      type="text"
      bind:value={wizard.dockerNetworkName}
    >
    {#if showError("dockerNetworkName")}
      <p class={errorClass}>{showError("dockerNetworkName")}</p>
    {/if}
  </div>

  <AsyncBlock errorTitle="Couldn't check this host's swarm state." query={swarm}>
    {#snippet pending()}
      <Skeleton class="h-16 w-full" />
    {/snippet}
    {#snippet children(readiness)}
      {@const ready =
        readiness.swarmActive &&
        readiness.overlayReady &&
        readiness.traefikSwarmProvider}
      <div
        class="rounded-md border p-3 text-xs {ready
          ? 'border-emerald-500/30 bg-emerald-500/5'
          : 'border-border bg-surface-2'}"
      >
        <p class="text-text font-medium">
          Swarm mode {ready ? "is ready on this host" : "isn't set up"}
        </p>
        <ul class="text-text-muted mt-2 space-y-1">
          {@render swarmCheck(
            readiness.swarmActive,
            "This daemon is a swarm manager",
            "docker swarm init hasn't been run here",
          )}
          {@render swarmCheck(
            readiness.overlayReady,
            `Overlay network ${readiness.network} exists`,
            `Overlay network ${readiness.network} is missing`,
          )}
          {@render swarmCheck(
            readiness.traefikSwarmProvider,
            "Traefik runs its swarm provider",
            readiness.traefikFound
              ? "Traefik's swarm provider is off"
              : "No Traefik container found on this host",
          )}
        </ul>
        <p class="text-text-subtle mt-2">
          Standalone containers don't need any of this. Switching to
          swarm later from Settings → Docker sets up whatever's
          missing above.
        </p>
      </div>
    {/snippet}
  </AsyncBlock>
</StepPanel>
