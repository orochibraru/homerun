<script lang="ts">
	import { RefreshCw, ShieldCheck, Trash2 } from "@lucide/svelte";
	import Alert from "#lib/components/alert.svelte";
	import ConfirmDialog from "#lib/components/confirm-dialog.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Textarea } from "#lib/components/ui/textarea/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	const certificate = $derived(data.certificate);
	const daysLeft = $derived(
		certificate?.expiresAt
			? Math.floor(
					(new Date(certificate.expiresAt).getTime() - Date.now()) / 86_400_000,
				)
			: null,
	);

	let removeOpen = $state(false);
	let removeForm = $state<HTMLFormElement>();
</script>

<div class="space-y-6">
  {#if data.behindPangolin}
    <Alert>
      This instance is behind Pangolin, which serves the certificates visitors
      see. A certificate here only secures the hop from the tunnel to Traefik.
    </Alert>
  {/if}
  {#if !data.dynamicConfigDir}
    <Alert>
      Traefik's dynamic config directory isn't set (Settings → Networking), so a
      certificate can't be installed yet.
    </Alert>
  {/if}

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Instance certificate</h2>
      <p class="text-text-muted text-xs">
        One certificate for the base domain and its subdomains, served by Traefik
        instead of Let's Encrypt: a Cloudflare origin certificate, or any other
        you manage yourself.
      </p>
    </div>

    {#if certificate}
      <div class="border-border flex flex-wrap items-start justify-between gap-4 border-b px-5 py-4">
        <div class="min-w-0 space-y-1 text-sm">
          <p class="text-text flex items-center gap-2 font-medium">
            <ShieldCheck class="size-4 text-emerald-500" />
            {certificate.names.join(", ")}
          </p>
          <p class="text-text-muted text-xs">
            Issued by {certificate.issuer ?? "an unknown issuer"}
            {#if certificate.expiresAt}
              · expires {new Date(certificate.expiresAt).toLocaleDateString()}
              {#if daysLeft !== null && daysLeft < 30}
                <span class="text-amber-600">({daysLeft} days left)</span>
              {/if}
            {/if}
          </p>
        </div>
        <form
          action="?/remove"
          bind:this={removeForm}
          method="POST"
          use:enhance={enhanceToast({
            error: "Couldn't remove the certificate.",
            loading: "Removing the certificate",
            success: "Certificate removed. Redeploy services to go back to Let's Encrypt.",
          })}
        >
          <Button onclick={() => (removeOpen = true)} size="sm" type="button" variant="outline">
            <Trash2 class="size-4" />
            Remove
          </Button>
        </form>
      </div>
      {#if data.coveredServices.length > 0}
        <form
          action="?/redeployCovered"
          class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4"
          method="POST"
          use:enhance={enhanceToast({
            error: "Couldn't queue the redeploys.",
            loading: "Queueing redeploys",
            success: (result) =>
              `${(result as { redeployed?: number } | undefined)?.redeployed ?? 0} redeploy(s) queued.`,
          })}
        >
          <p class="text-text-muted text-sm">
            {data.coveredServices.length} deployed service{data.coveredServices.length === 1
              ? ""
              : "s"}
            ({data.coveredServices.map((svc) => svc.name).join(", ")}) still ask Let's
            Encrypt for their certificate until they're redeployed.
          </p>
          <Button size="sm" type="submit" variant="outline">
            <RefreshCw class="size-4" />
            Redeploy them
          </Button>
        </form>
      {/if}
    {/if}

    <form
      action="?/install"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't install the certificate.",
        loading: "Installing the certificate",
        reset: true,
        success: (result) =>
          `Installed for ${(result as { installed?: string } | undefined)?.installed ?? "the instance"}.`,
      })}
    >
      <div class="grid gap-4 lg:grid-cols-2">
        <div>
          <label class={label} for="cert">
            {certificate ? "Replace with a new certificate" : "Certificate"}
          </label>
          <Textarea
            class="font-mono text-xs"
            id="cert"
            name="cert"
            placeholder={"-----BEGIN CERTIFICATE-----\n…\n-----END CERTIFICATE-----"}
            required
            rows={8}
          />
        </div>
        <div>
          <label class={label} for="key">Private key</label>
          <Textarea
            class="font-mono text-xs"
            id="key"
            name="key"
            placeholder={"-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----"}
            required
            rows={8}
          />
        </div>
      </div>
      <p class="text-text-subtle text-xs">
        PEM, the certificate first then any intermediates. For Cloudflare: SSL/TLS
        → Origin Server → Create Certificate, for your domain and
        <code>*.yourdomain</code>, then set the SSL/TLS mode to Full (strict).
        Traefik serves it for every hostname it covers, and services on those
        hostnames stop asking Let's Encrypt from their next deploy. The key is
        stored encrypted.
      </p>
      <div class="flex justify-end">
        <Button disabled={!data.dynamicConfigDir} type="submit">
          <ShieldCheck class="size-4" />
          Install
        </Button>
      </div>
    </form>
  </section>
</div>

<ConfirmDialog
  bind:open={removeOpen}
  confirmLabel="Remove"
  description="Traefik goes back to Let's Encrypt for these hostnames once their services are redeployed. Behind Cloudflare's proxy with Full (strict), visitors may see errors until then."
  onConfirm={() => removeForm?.requestSubmit()}
  title="Remove the instance certificate"
/>
