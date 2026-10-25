<script lang="ts">
	import { Eraser, Loader2, Power } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import UptimePanel from "#lib/components/uptime-panel.svelte";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Uptime`));

	let togglingUptime = $state(false);
	let clearing = $state(false);
</script>

<div>
  <UptimePanel
    beats={data.uptime}
    enabled={data.service.uptimeEnabled}
    externalSkipped={data.externalSkipped}
  >
    {#snippet headerAction()}
      <form
        action="?/setUptime"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't change uptime probing.",
          loading: "Saving uptime probing",
          onSettled: () => {
            togglingUptime = false;
          },
          onStart: () => {
            togglingUptime = true;
          },
          success: (result) =>
            result?.uptimeEnabled
              ? "Uptime probing is on."
              : "Uptime probing is off.",
        })}
      >
        <input
          name="uptimeEnabled"
          type="hidden"
          value={data.service.uptimeEnabled ? "false" : "true"}
        />
        <Button disabled={togglingUptime} size="sm" type="submit" variant="outline">
          {#if togglingUptime}
            <Loader2 class="size-3.5 animate-spin" />
          {:else}
            <Power class="size-3.5" />
          {/if}
          {data.service.uptimeEnabled ? "Turn off" : "Turn on"}
        </Button>
      </form>
    {/snippet}
  </UptimePanel>
  {#if data.uptime.internal.length > 0 || data.uptime.external.length > 0}
    <form
      action="?/clearHeartbeats"
      class="mt-2 flex justify-end"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't clear the heartbeats.",
        loading: "Clearing heartbeats",
        onSettled: () => {
          clearing = false;
        },
        onStart: () => {
          clearing = true;
        },
        success: "Heartbeats cleared.",
      })}
    >
      <Button
        disabled={clearing}
        size="sm"
        type="submit"
        variant="ghost"
      >
        <Eraser class="size-3.5" />
        Clear heartbeats
      </Button>
    </form>
  {/if}
</div>
