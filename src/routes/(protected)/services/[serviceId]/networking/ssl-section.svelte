<script lang="ts">
	import { Check, ShieldCheck } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
	import { isUnderDomain } from "$lib/service-domains";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		baseDomain: string;
		behindPangolin: boolean;
		certResolver: string | null;
		submitting: boolean;
		svc: {
			customSslCertEnc: string | null;
			customSslKeyEnc: string | null;
			dnsResolvable: boolean;
			domains: string[];
		};
	}

	let {
		baseDomain,
		behindPangolin,
		certResolver,
		submitting = $bindable(),
		svc,
	}: Props = $props();

	const outsideDomains = $derived(
		svc.domains.filter((domain) => !isUnderDomain(domain, baseDomain)),
	);
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <ShieldCheck class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">SSL</p>
      <p class="text-text-muted text-xs">
        {#if svc.dnsResolvable && behindPangolin}
          Pangolin serves the public certificates for this service's domains
          : Traefik only encrypts the hop from the tunnel with its default certificate.
        {:else if svc.dnsResolvable && !certResolver}
          Domains under {baseDomain} can't get a public certificate, since
          ACME only issues for real domain names : Traefik serves its self-signed
          default instead.
        {:else if svc.dnsResolvable}
          TLS is automatic via Traefik's
          <code>{certResolver}</code>
          resolver for every domain of this service : no certificate handling
          needed.
        {:else}
          Not applicable : this service isn't publicly routed.
        {/if}
      </p>
    </div>
  </div>

  {#if svc.dnsResolvable && !behindPangolin && outsideDomains.length > 0}
    <form
      action="?/updateSsl"
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
        Optional: your own certificate for
        <strong>{outsideDomains.join(", ")}</strong>, instead of the automatic
        one. Requires the admin to have set
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
        <Button disabled={submitting} type="submit" variant="outline">
          {#if submitting}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save certificate
        </Button>
        <p class="text-text-subtle text-xs">Redeploy for changes to take effect.</p>
      </div>
    </form>
  {/if}
</section>
