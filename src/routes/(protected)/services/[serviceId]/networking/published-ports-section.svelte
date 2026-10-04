<script lang="ts">
	import { Plug } from "@lucide/svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import PublishedPortsFields from "#lib/components/published-ports-fields.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import type { PublishedPort } from "#lib/published-ports.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		svc: {
			containerPort: number;
			networkMode: string;
			publishedPorts: PublishedPort[];
		};
	}

	const { svc }: Props = $props();

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="Bind a port on this machine straight to the container, for what Traefik can't route by domain : UDP (VPN, game servers, DNS) or raw TCP (SSH, databases). Clients reach it at any hostname pointing at this machine, on the host port."
    icon={Plug}
    title="Published ports"
  >
    {#snippet trailing()}
      {#if svc.networkMode !== "host"}
        <SaveButton form="service-published-ports" pending={submitting} />
      {/if}
    {/snippet}
  </PanelHeader>

  {#if svc.networkMode === "host"}
    <p class="text-text-muted p-5 text-sm">
      Host networking already exposes every port the container listens on :
      there's nothing to publish.
    </p>
  {:else}
    <form
      id="service-published-ports"
      action="?/updatePublishedPorts"
      class="space-y-3 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the published ports.",
        loading: "Saving published ports",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Saved. Redeploy for it to take effect.",
      })}
    >
      <PublishedPortsFields
        defaultContainerPort={svc.containerPort}
        ports={svc.publishedPorts}
      />

      <p class="text-text-subtle text-xs">
        Redeploy for changes to take effect. A service with published ports
        stops its old container before starting the new one.
      </p>
    </form>
  {/if}
</section>
