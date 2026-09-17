<script lang="ts">
	import { Check, Globe, Network, ShieldCheck } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
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
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();
	const svc = $derived(data.service);
	const publicHost = $derived(
		data.stackSlug ? `${data.stackSlug}-${svc.slug}` : svc.slug,
	);

	onMount(() => title.set(`${svc.name} · Networking`));

	let submitting = $state(false);

	const portsValues = $derived(
		(form?.portsValues as Record<string, string> | undefined) ?? {
			containerPort: String(svc.containerPort),
			dnsResolvable: svc.dnsResolvable ? "on" : "",
			networkMode: svc.networkMode,
			portProtocol: svc.portProtocol,
		},
	);
	const portsErrors = $derived(
		form?.errors as Record<string, string[]> | undefined,
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

{#snippet applyNote()}
  <p class="text-text-subtle text-xs">Redeploy for changes to take effect.</p>
{/snippet}

<div class="space-y-6">
  <!-- ═══ DNS / public routing ═══ -->
  <section class="panel rounded-md p-5">
    <div class="mb-4 flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <Globe class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">DNS</p>
        <p class="text-text-muted text-xs">
          {#if svc.dnsResolvable}
            Publicly routed at
            <span class="text-accent">{publicHost}.{data.baseDomain}</span>.
          {:else if svc.networkMode === "host"}
            Not publicly routed : this service is on the host network (see
            Network below), which Traefik can't route to.
          {:else}
            Not publicly routed : subnet-only. Change this in the Network
            section below.
          {/if}
        </p>
      </div>
    </div>

    {#if svc.dnsResolvable}
      <form
        action="?/updateNetworking"
        class="space-y-3"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the domain and try again.",
          loading: "Saving the domain",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "Saved. Redeploy for it to take effect.",
        })}
      >
        {#if form?.error}
          <p class="text-xs text-red-500">{form.error}</p>
        {/if}
        <div>
          <label class={label} for="customDomain">Custom domain</label>
          <Input
            id="customDomain"
            name="customDomain"
            placeholder="app.example.com"
            type="text"
            value={svc.customDomain ?? ""}
          />
          <p class="text-text-subtle mt-1.5 text-xs">
            Optional second hostname routed to this service, alongside its
            {publicHost}.{data.baseDomain}
            address. Point its DNS (A/CNAME) at this server yourself first :
            this app only tells Traefik to route it, it doesn't manage DNS.
          </p>
        </div>

        <div class="flex flex-wrap items-center gap-3">
          <Button disabled={submitting} type="submit" variant="outline">
            {#if submitting}
              <Spinner />
            {:else}
              <Check class="size-4" />
            {/if}
            Save
          </Button>
          {@render applyNote()}
        </div>
      </form>
    {/if}
  </section>

  <!-- ═══ SSL ═══ -->
  <section class="panel rounded-md p-5">
    <div class="mb-4 flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <ShieldCheck class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">SSL</p>
        <p class="text-text-muted text-xs">
          {#if svc.dnsResolvable && data.behindPangolin}
            Pangolin serves the public certificate for {publicHost}.{data.baseDomain}
            : Traefik only encrypts the hop from the tunnel with its default certificate.
          {:else if svc.dnsResolvable && !data.certResolver}
            {publicHost}.{data.baseDomain} can't get a public certificate, since
            ACME only issues for real domain names : Traefik serves its self-signed
            default instead.
          {:else if svc.dnsResolvable}
            TLS is automatic via Traefik's
            <code>{data.certResolver}</code>
            resolver for {publicHost}.{data.baseDomain}
            : no certificate handling needed for that hostname.
          {:else}
            Not applicable : this service isn't publicly routed.
          {/if}
        </p>
      </div>
    </div>

    {#if svc.dnsResolvable && svc.customDomain}
      <form
        action="?/updateNetworking"
        class="border-border space-y-3 border-t pt-4"
        method="POST"
        use:enhance={enhanceToast({
          error: "Check the certificate and try again.",
          loading: "Saving the certificate",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "Saved. Redeploy for it to take effect.",
        })}
      >
        <p class="text-text-muted text-xs">
          A custom certificate for <strong>{svc.customDomain}</strong> : since
          it isn't a subdomain of this instance's base domain, the automatic
          resolver above can't cover it. Requires the admin to have set
          <code>TRAEFIK_DYNAMIC_CONFIG_DIR</code>
          and enabled Traefik's file provider (see compose.yaml) : this app
          writes the cert/key files there, it doesn't touch the Traefik
          container itself.
        </p>
        <div>
          <label class={label} for="customSslCert">Certificate (PEM)</label>
          <Textarea
            class="resize-none"
            id="customSslCert"
            name="customSslCert"
            placeholder={svc.customSslCertEnc
            ? "Unchanged"
            : "-----BEGIN CERTIFICATE-----"}
            rows={4}
          />
        </div>
        <div>
          <label class={label} for="customSslKey">Private key (PEM)</label>
          <Textarea
            class="resize-none"
            id="customSslKey"
            name="customSslKey"
            placeholder={svc.customSslKeyEnc
            ? "Unchanged"
            : "-----BEGIN PRIVATE KEY-----"}
            rows={4}
          />
        </div>
        {#if svc.customSslCertEnc}
          <CheckBox
            checked={false}
            helperText="Clears the certificate and key instead of saving new ones above"
            id="clearSsl"
            label="Remove the stored certificate instead of replacing it"
            name="clearSsl"
          />
        {/if}
        <div class="flex flex-wrap items-center gap-3">
          <button
            class="border-border text-text hover:bg-surface-2 flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {#if submitting}
              <Spinner />
            {:else}
              <Check class="size-4" />
            {/if}
            Save certificate
          </button>
          {@render applyNote()}
        </div>
      </form>
    {/if}
  </section>

  <!-- ═══ Network ═══ -->
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
          {:else if svc.containerId}
            Reachable from other services at
            <span class="text-text-subtle">{svc.slug}:{
                svc.containerPort
              }</span>.
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
          helperText="Get a public {svc.slug}.{data.baseDomain} route. Turn off to keep this service reachable only from other services on the same network."
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
        {@render applyNote()}
      </div>
    </form>
  </section>
</div>
