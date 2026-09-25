<script lang="ts">
	import { Check, Network } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import CopyButton from "$lib/components/copy-button.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { internalUrl, maskUrlPassword } from "$lib/service-link";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		baseDomain: string;
		errors?: Record<string, string[]>;
		submittedValues?: Record<string, string>;
		svc: {
			command: string[] | null;
			containerId: string | null;
			containerPort: number;
			dnsResolvable: boolean;
			envVars: Record<string, string> | null;
			image: string;
			name: string;
			networkMode: string;
			portProtocol: string;
			slug: string;
			swarmServiceId: string | null;
		};
	}

	const {
		baseDomain,
		errors: portsErrors,
		submittedValues,
		svc,
	}: Props = $props();

	const internal = $derived(
		internalUrl({ ...svc, envVars: svc.envVars ?? {} }),
	);

	const portsValues = $derived(
		submittedValues ?? {
			containerPort: String(svc.containerPort),
			dnsResolvable: svc.dnsResolvable ? "on" : "",
			networkMode: svc.networkMode,
			portProtocol: svc.portProtocol,
		},
	);
	let submittingPorts = $state(false);

	let networkMode = $derived<"bridge" | "host">(
		(portsValues.networkMode as "bridge" | "host" | undefined) ?? "bridge",
	);

	let portProtocol = $derived<"tcp" | "udp" | "both">(
		(portsValues.portProtocol as "tcp" | "udp" | "both" | undefined) ?? "tcp",
	);
	const portProtocolOptions: [string, string][] = [
		["tcp", "TCP"],
		["udp", "UDP"],
		["both", "Both"],
	];
	const portProtocolLabel = $derived(
		portProtocolOptions.find(([val]) => val === portProtocol)?.[1] ?? "TCP",
	);
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
      <Network class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Network</p>
      <p class="text-text-muted text-xs">
        {#if networkMode === "host"}
          Runs on the host's own network : reachable directly on this machine
          at its own port, not through Traefik or the shared network.
        {:else if svc.containerId || svc.swarmServiceId}
          Reachable from other services at
          <span class="text-text-subtle">{maskUrlPassword(internal)}</span>
          <CopyButton class="p-0.5 align-middle" label="internal URL" value={internal} />
        {:else}
          Container port
          <span class="text-text-subtle">{svc.containerPort}</span>
          (deploy to make it reachable).
        {/if}
      </p>
    </div>
  </div>

  <form
    action="?/updatePorts"
    class="space-y-4"
    method="POST"
    use:enhance={enhanceToast({
      error: "Check the form for errors.",
      loading: "Saving network settings",
      onSettled: () => {
        submittingPorts = false;
      },
      onStart: () => {
        submittingPorts = true;
      },
      success: "Saved. Redeploy for it to take effect.",
    })}
  >
    <div>
      <div class={label}>Network mode</div>
      <div class="grid grid-cols-2 gap-3">
        <button
          class="
            flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all {networkMode ===
            'bridge'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted hover:bg-surface-2'}
         "
          onclick={() => {
            networkMode = "bridge";
          }}
          type="button"
        >
          Bridge (default)
        </button>
        <button
          class="
            flex items-center justify-center gap-2 rounded-md border px-4 py-2.5 text-sm font-medium transition-all {networkMode ===
            'host'
            ? 'border-accent bg-accent-light text-accent'
            : 'border-border text-text-muted hover:bg-surface-2'}
         "
          onclick={() => {
            networkMode = "host";
          }}
          type="button"
        >
          Host
        </button>
      </div>
      <input name="networkMode" type="hidden" value={networkMode}>
      <p class="text-text-subtle mt-1.5 text-xs">
        {#if networkMode === "host"}
          Shares this machine's network namespace directly : for apps that
          need real host-network access (mDNS/SSDP discovery, e.g. Home
          Assistant). No shared/stack network, no Traefik routing, no public
          DNS route regardless of the setting below.
        {:else}
          Joins the shared Traefik network (plus its stack's network, if
          any) : the normal mode for anything that doesn't specifically need
          host networking.
        {/if}
      </p>
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <label class={label} for="containerPort">
          Container port <span class="text-red-500">*</span>
        </label>
        <Input
          id="containerPort"
          max="65535"
          min="1"
          name="containerPort"
          required
          type="number"
          value={portsValues.containerPort}
        />
        {#if portsErrors?.containerPort}
          <p class="mt-1.5 text-xs text-red-500">
            {portsErrors.containerPort[0]}
          </p>
        {/if}
      </div>
      <div>
        <label class={label} for="portProtocol">Protocol</label>
        <SelectRoot
          name="portProtocol"
          type="single"
          bind:value={portProtocol}
        >
          <SelectTrigger class="w-full" id="portProtocol">
            {portProtocolLabel}
          </SelectTrigger>
          <SelectContent>
            {#each portProtocolOptions as [val, lbl] (val)}
              <SelectItem label={lbl} value={val} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>
    </div>

    {#if networkMode === "bridge"}
      <CheckBox
        checked={portsValues.dnsResolvable === "on"}
        helperText="Get a public {svc.slug}.{baseDomain} route. Turn off to keep this service reachable only from other services on the same network."
        id="dnsResolvable"
        label="DNS-resolvable"
        name="dnsResolvable"
      />
    {/if}

    <div class="flex flex-wrap items-center gap-3">
      <Button disabled={submittingPorts} type="submit" variant="outline">
        {#if submittingPorts}
          <Spinner />
        {:else}
          <Check class="size-4" />
        {/if}
        Save
      </Button>
      <p class="text-text-subtle text-xs">Redeploy for changes to take effect.</p>
    </div>
  </form>
</section>
