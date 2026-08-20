<script lang="ts">
  import { Check, Globe, Loader2, Network, ShieldCheck } from "@lucide/svelte";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { resolve } from "$app/paths";
  import CheckBox from "$lib/components/check-box.svelte";
  import {
    inputClass as input,
    labelClass as label,
  } from "$lib/components/form-styles";
  import { title } from "$lib/store/title";

  const { data, form } = $props();
  const svc = $derived(data.service);
  const publicHost = $derived(
    data.projectSlug ? `${data.projectSlug}-${svc.slug}` : svc.slug
  );

  onMount(() => title.set(`${svc.name} · Networking`));

  let submitting = $state(false);
</script>

<div class="space-y-6">
  <!-- ═══ DNS / public routing ═══ -->
  <section class="rounded-2xl border border-border bg-surface p-5">
    <div class="mb-4 flex items-center gap-3">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <Globe class="size-4" />
      </div>
      <div>
        <p class="text-sm font-medium text-text">DNS</p>
        <p class="text-xs text-text-muted">
          {#if svc.dnsResolvable}
            Publicly routed at
            <span class="text-accent">{publicHost}.{data.baseDomain}</span>.
          {:else}
            Not publicly routed — subnet-only. Change this on the
            <a
              class="underline"
              href={resolve("/services/[serviceId]/settings", {
                serviceId: svc.id,
              })}
              >Settings</a
            >
            tab.
          {/if}
        </p>
      </div>
    </div>

    {#if svc.dnsResolvable}
      <form
        action="?/updateNetworking"
        class="space-y-3"
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({ result, update }) => {
            submitting = false;
            if (result.type === "success") {
              toast.success("Saved.");
            } else if (result.type === "failure") {
              toast.error("Check the domain and try again.");
            }
            await update();
          };
        }}
      >
        {#if form?.error}
          <p class="text-xs text-red-500">{form.error}</p>
        {/if}
        <div>
          <label class={label} for="customDomain">Custom domain</label>
          <input
            class={input}
            id="customDomain"
            name="customDomain"
            placeholder="app.example.com"
            type="text"
            value={svc.customDomain ?? ""}
          >
          <p class="mt-1.5 text-xs text-text-subtle">
            Optional second hostname routed to this service, alongside its
            {publicHost}.{data.baseDomain}
            address. Point its DNS (A/CNAME) at this server yourself first —
            this app only tells Traefik to route it, it doesn't manage DNS.
          </p>
        </div>

        <div class="border-t border-border pt-3">
          <CheckBox
            checked={svc.authRequired}
            helperText="Gate this app behind Homerun's own login via Traefik forwardAuth"
            id="authRequired"
            label="Require login to access this app"
            name="authRequired"
          />
          <p class="mt-1.5 text-xs text-red-500">
            ⚠ In its current form this blocks <em>everyone</em>, including you —
            there's no login page mounted on this app's own hostname to
            authenticate against. Treat it as a hard "make this unreachable from
            the public internet" switch (defense-in-depth, or temporarily
            pulling something offline), not as a working per-app login wall yet.
          </p>
          <p class="mt-1.5 text-xs text-text-subtle">
            Checks Traefik forwardAuth requests against this instance's own
            session (any provider you sign into Homerun with, including a
            configured OIDC one) — anyone without a valid session for
            <em>this exact hostname</em>
            gets a 401. Setting
            <code>AUTH_CROSS_SUBDOMAIN=true</code>
            widens the session cookie to cover every subdomain of the base
            domain, which is a real security tradeoff and, in testing, wasn't
            sufficient on its own for a signed-in admin to pass through
            automatically — a proper login-redirect flow for gated subdomains
            isn't built yet.
          </p>
        </div>

        <button
          class="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {#if submitting}
            <Loader2 class="size-4 animate-spin" />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </button>
      </form>
    {/if}
  </section>

  <!-- ═══ SSL ═══ -->
  <section class="rounded-2xl border border-border bg-surface p-5">
    <div class="mb-4 flex items-center gap-3">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <ShieldCheck class="size-4" />
      </div>
      <div>
        <p class="text-sm font-medium text-text">SSL</p>
        <p class="text-xs text-text-muted">
          {#if svc.dnsResolvable}
            TLS is automatic via Traefik's
            <code>{data.certResolver}</code>
            resolver for {publicHost}.{data.baseDomain}
            — no certificate handling needed for that hostname.
          {:else}
            Not applicable — this service isn't publicly routed.
          {/if}
        </p>
      </div>
    </div>

    {#if svc.dnsResolvable && svc.customDomain}
      <form
        action="?/updateNetworking"
        class="space-y-3 border-t border-border pt-4"
        method="POST"
        use:enhance={() => {
          submitting = true;
          return async ({ result, update }) => {
            submitting = false;
            if (result.type === "success") {
              toast.success("Saved.");
            } else if (result.type === "failure") {
              toast.error("Check the certificate and try again.");
            }
            await update();
          };
        }}
      >
        <p class="text-xs text-text-muted">
          A custom certificate for <strong>{svc.customDomain}</strong> — since
          it isn't a subdomain of this instance's base domain, the automatic
          resolver above can't cover it. Requires the admin to have set
          <code>TRAEFIK_DYNAMIC_CONFIG_DIR</code>
          and enabled Traefik's file provider (see compose.yaml) — this app
          writes the cert/key files there, it doesn't touch the Traefik
          container itself.
        </p>
        <div>
          <label class={label} for="customSslCert">Certificate (PEM)</label>
          <textarea
            class="{input} resize-none font-mono"
            id="customSslCert"
            name="customSslCert"
            placeholder={svc.customSslCertEnc ? "Unchanged" : "-----BEGIN CERTIFICATE-----"}
            rows="4"
          ></textarea>
        </div>
        <div>
          <label class={label} for="customSslKey">Private key (PEM)</label>
          <textarea
            class="{input} resize-none font-mono"
            id="customSslKey"
            name="customSslKey"
            placeholder={svc.customSslKeyEnc ? "Unchanged" : "-----BEGIN PRIVATE KEY-----"}
            rows="4"
          ></textarea>
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
        <button
          class="flex items-center gap-2 rounded-xl border border-border px-4 py-2 text-sm font-medium text-text transition-all hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={submitting}
          type="submit"
        >
          {#if submitting}
            <Loader2 class="size-4 animate-spin" />
          {:else}
            <Check class="size-4" />
          {/if}
          Save certificate
        </button>
      </form>
    {/if}
  </section>

  <!-- ═══ Ports ═══ -->
  <section class="rounded-2xl border border-border bg-surface p-5">
    <div class="flex items-center gap-3">
      <div
        class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg"
      >
        <Network class="size-4" />
      </div>
      <div>
        <p class="text-sm font-medium text-text">Ports</p>
        <p class="text-xs text-text-muted">
          {#if svc.containerId}
            Reachable from other services at
            <span class="font-mono text-text-subtle"
              >{svc.slug}:{svc.containerPort}</span
            >.
          {:else}
            Container port
            <span class="font-mono text-text-subtle">{svc.containerPort}</span>
            (deploy to make it reachable).
          {/if}
          No host ports are published — containers only communicate over Docker
          networks (the shared network, plus their project's network if any),
          reached through Traefik or by hostname from sibling services. There's
          no "map container port X to host port Y" control here by design.
        </p>
      </div>
    </div>
  </section>
</div>
