<script lang="ts">
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();
</script>

<div class="space-y-6">
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Traefik</h2>
      <p class="text-text-muted text-xs">
        Entrypoint, cert resolver, ACME account email, and the custom-SSL
        dynamic-config directory.
      </p>
    </div>
    <form
      action="?/updateTraefik"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving Traefik settings",
        success: "Traefik settings saved.",
      })}
    >
      <div>
        <label class={label} for="traefikAcmeEmail">ACME account email</label>
        <Input
          id="traefikAcmeEmail"
          name="traefikAcmeEmail"
          placeholder={data.envDefaults.traefikAcmeEmail ?? "admin@example.com"}
          type="email"
          value={data.settings.traefikAcmeEmail ?? ""}
        />
        <p
          class="mt-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400"
        >
          <strong>Doesn't take effect by saving here.</strong> The contact
          email Traefik registers with Let's Encrypt when generating
          certificates : recorded for reference and validated as a real
          email, but this app never touches the running Traefik container's
          own config. Traefik reads it from the
          <code class="font-mono">ACME_EMAIL</code>
          env var at container startup (compose.yaml's
          <code class="font-mono">--certificatesresolvers.letsencrypt.acme.email</code>
          flag) : set it there and recreate the Traefik container for a
          change to actually take effect.
        </p>
      </div>
      <div>
        <label class={label} for="traefikEntrypoint">Entrypoint</label>
        <Input
          id="traefikEntrypoint"
          name="traefikEntrypoint"
          placeholder={data.envDefaults.traefikEntrypoint}
          type="text"
          value={data.settings.traefikEntrypoint ?? ""}
        />
      </div>
      <div>
        <label class={label} for="traefikCertResolver">Cert resolver</label>
        <Input
          id="traefikCertResolver"
          name="traefikCertResolver"
          placeholder={data.envDefaults.traefikCertResolver}
          type="text"
          value={data.settings.traefikCertResolver ?? ""}
        />
      </div>
      <div>
        <label class={label} for="traefikDynamicConfigDir"
        >Dynamic config directory</label>
        <Input
          class="font-mono"
          id="traefikDynamicConfigDir"
          name="traefikDynamicConfigDir"
          placeholder={data.envDefaults.traefikDynamicConfigDir
          ?? "unset : custom SSL is a no-op"}
          type="text"
          value={data.settings.traefikDynamicConfigDir ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          Must match the path bind-mounted into the Traefik container : see
          compose.yaml's commented-out example. Unset means per-service custom
          SSL certs are stored but never written anywhere.
        </p>
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Cloudflare</h2>
      <p class="text-text-muted text-xs">
        Auto-creates a DNS record for every deployed service's
        <code>&lt;slug&gt;.{data.settings.baseDomain
        ?? data.envDefaults.baseDomain}</code>
        hostname. Unset : no-op, add records by hand as before.
      </p>
    </div>
    <form
      action="?/updateCloudflare"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving Cloudflare settings",
        success: (data) =>
          data?.cloudflareTestOk
            ? "Zone access verified."
            : "Cloudflare settings saved.",
      })}
    >
      <div>
        <label class={label} for="cloudflareZoneId">Zone ID</label>
        <Input
          class="font-mono"
          id="cloudflareZoneId"
          name="cloudflareZoneId"
          type="text"
          value={data.settings.cloudflareZoneId ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The zone your base domain lives in, found on that domain's
          Cloudflare dashboard overview page.
        </p>
      </div>
      <div>
        <label class={label} for="cloudflareApiToken">API token</label>
        <Input
          id="cloudflareApiToken"
          name="cloudflareApiToken"
          placeholder={data.settings.cloudflareZoneId
          ? "Unchanged"
          : "Zone:DNS:Edit scope"}
          type="password"
        />
      </div>
      <div class="flex justify-end gap-2">
        <Button formaction="?/testCloudflare" type="submit" variant="outline">
          Test connection
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Pangolin</h2>
      <p class="text-text-muted text-xs">
        Alternative to Cloudflare above, for instances fronted by a
        self-hosted <a
          class="text-primary underline"
          href="https://api.pangolin.net/v1/docs/"
          rel="noreferrer"
          target="_blank"
        >Pangolin</a> tunnel instead of a DNS provider. Auto-creates a
        Resource + Target for every deployed service's hostname, routed
        through the site below. Unset : no-op, wire routes up by hand as
        before.
      </p>
    </div>
    <form
      action="?/updatePangolin"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving Pangolin settings",
        success: (data) =>
          data?.pangolinTestOk
            ? "Org access verified."
            : "Pangolin settings saved.",
      })}
    >
      <div>
        <label class={label} for="pangolinApiBaseUrl">API base URL</label>
        <Input
          class="font-mono"
          id="pangolinApiBaseUrl"
          name="pangolinApiBaseUrl"
          placeholder="https://pangolin.example.com/api/v1"
          type="text"
          value={data.settings.pangolinApiBaseUrl ?? ""}
        />
      </div>
      <div>
        <label class={label} for="pangolinOrgId">Org ID</label>
        <Input
          class="font-mono"
          id="pangolinOrgId"
          name="pangolinOrgId"
          type="text"
          value={data.settings.pangolinOrgId ?? ""}
        />
      </div>
      <div>
        <label class={label} for="pangolinMainSiteName">Site name</label>
        <Input
          class="font-mono"
          id="pangolinMainSiteName"
          name="pangolinMainSiteName"
          type="text"
          value={data.settings.pangolinMainSiteName ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The Pangolin site (tunnel agent) whose host runs this instance's
          own Traefik. Must already exist in Pangolin.
        </p>
      </div>
      <div>
        <label class={label} for="pangolinTargetPort">Target port</label>
        <Input
          id="pangolinTargetPort"
          name="pangolinTargetPort"
          placeholder="80"
          type="number"
          value={data.settings.pangolinTargetPort ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The local port on that site's host a Resource's Target forwards
          to. Unset defaults to 80 (this instance's own Traefik entrypoint,
          HTTP-only : Pangolin terminates the public TLS connection
          itself).
        </p>
      </div>
      <div>
        <label class={label} for="pangolinApiToken">API token</label>
        <Input
          id="pangolinApiToken"
          name="pangolinApiToken"
          placeholder={data.settings.pangolinOrgId ? "Unchanged" : ""}
          type="password"
        />
      </div>
      <div class="flex justify-end gap-2">
        <Button formaction="?/testPangolin" type="submit" variant="outline">
          Test connection
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>
</div>
