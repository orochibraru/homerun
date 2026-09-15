<script lang="ts">
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
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
        success: (data) =>
          (data?.traefikDetail as string | null) ?? "Traefik settings saved.",
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
        <p class="text-text-subtle mt-1.5 text-xs">
          The contact address Traefik registers with Let's Encrypt. Traefik
          only reads it at startup, so saving a <em>new</em> one here
          rewrites
          <code class="">--certificatesresolvers.&lt;resolver&gt;.acme.email</code>
          on the running container and recreates it : expect a few seconds of
          downtime, and this page may blink if you reach it through Traefik.
          Saving the value it already has changes nothing.
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
          class=""
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

  <section class="panel rounded-md">
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
          class=""
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

  <section class="panel rounded-md">
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
        through the site below. Every field here is required : with any of
        them blank the integration stays off. "Test connection" checks the
        whole set, not just the token, and each deploy writes what Pangolin
        did into its own deployment log.
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
            ? `Pangolin reachable : ${data.pangolinTestDetail ?? "org access verified"}.`
            : "Pangolin settings saved.",
      })}
    >
      <div>
        <label class={label} for="pangolinApiBaseUrl">API base URL</label>
        <Input
          class=""
          id="pangolinApiBaseUrl"
          name="pangolinApiBaseUrl"
          placeholder="https://api.pangolin.example.com/v1"
          type="text"
          value={data.settings.pangolinApiBaseUrl ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The <strong>Integration API</strong>, not the dashboard : it's a
          separate server (port 3003 by default) that self-hosted Pangolin
          only exposes once you enable it, and its base path ends in
          <code class="">/v1</code>. A dashboard URL like
          <code class="">/api/v1</code> authenticates with a session
          cookie, never an API key, so every call here would fail.
        </p>
      </div>
      <div>
        <label class={label} for="pangolinOrgId">Org ID</label>
        <Input
          class=""
          id="pangolinOrgId"
          name="pangolinOrgId"
          type="text"
          value={data.settings.pangolinOrgId ?? ""}
        />
      </div>
      <div>
        <label class={label} for="pangolinMainSiteName">Site name</label>
        <Input
          class=""
          id="pangolinMainSiteName"
          name="pangolinMainSiteName"
          type="text"
          value={data.settings.pangolinMainSiteName ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The Pangolin site (tunnel agent) whose host runs this instance's
          own Traefik. Must already exist in Pangolin, and is
          <strong>required</strong> : with it blank the integration stays off
          and no resource is ever created.
        </p>
      </div>
      {#if data.newt}
        <p class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
          <span class="size-1.5 rounded-full {data.newt.state === 'running'
          ? 'bg-emerald-500'
          : 'bg-amber-500'}"></span>
          A Pangolin tunnel client is on this host
          (<code class="font-mono">{data.newt.image}</code>, {data.newt.state}).
        </p>
      {:else}
        <p class="text-text-subtle rounded-lg border border-border px-3 py-2 text-xs">
          No Newt tunnel container found on this host. Pangolin can only reach
          services here through one : deploy the
          <strong>Newt (Pangolin tunnel)</strong> template, or run your own.
        </p>
      {/if}

      <div>
        <label class={label} for="pangolinTargetPort">Target port</label>
        <Input
          id="pangolinTargetPort"
          name="pangolinTargetPort"
          placeholder="443"
          type="number"
          value={data.settings.pangolinTargetPort ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The local port on that site's host a Resource's Target forwards to.
          Unset defaults to <strong>443</strong>, this instance's own
          <code class="">websecure</code> Traefik entrypoint, and the
          Target is created as <code class="">https</code>. Every
          service router Homerun writes lives on that entrypoint with TLS on,
          so a Target pointing at 80 reaches an entrypoint with no matching
          router and Traefik answers <strong>404</strong>. TLS is terminated
          twice on purpose : Pangolin for the public connection, Traefik again
          for the hop to the container.
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
