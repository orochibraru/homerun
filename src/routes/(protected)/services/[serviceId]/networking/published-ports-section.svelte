<script lang="ts">
	import { Check, Plug } from "@lucide/svelte";
	import PublishedPortsFields from "#lib/components/published-ports-fields.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import Spinner from "#lib/components/ui/spinner/spinner.svelte";
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

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <Plug class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Published ports</p>
      <p class="text-text-muted text-xs">
        Bind a port on this machine straight to the container, for what
        Traefik can't route by domain : UDP (VPN, game servers, DNS) or raw TCP
        (SSH, databases). Clients reach it at any hostname pointing at this
        machine, on the host port.
      </p>
    </div>
  </div>

  {#if svc.networkMode === "host"}
    <p class="text-text-muted text-sm">
      Host networking already exposes every port the container listens on :
      there's nothing to publish.
    </p>
  {:else}
    <form
      action="?/updatePublishedPorts"
      class="space-y-3"
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

      <div class="flex flex-wrap items-center gap-3">
        <Button disabled={submitting} type="submit" variant="outline">
          {#if submitting}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
        <p class="text-text-subtle text-xs">
          Redeploy for changes to take effect. A service with published ports
          stops its old container before starting the new one.
        </p>
      </div>
    </form>
  {/if}
</section>
