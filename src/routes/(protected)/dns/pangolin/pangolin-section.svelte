<script lang="ts">
	import { enhance } from "$app/forms";
	import AsyncBlock from "$lib/components/async-block.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import Skeleton from "$lib/components/skeleton.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { getNewtContainer } from "$lib/remote/setup.remote";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		settings: {
			pangolinApiBaseUrl: string | null;
			pangolinMainSiteName: string | null;
			pangolinNewtEndpoint: string | null;
			pangolinNewtId: string | null;
			pangolinNewtSecretEnc: string | null;
			pangolinOrgId: string | null;
			pangolinOwnsAuth: boolean | null;
			pangolinTargetHost: string | null;
			pangolinTargetPort: number | null;
		};
	}

	const { settings }: Props = $props();

	const newt = getNewtContainer();
</script>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Pangolin</h2>
      <p class="text-text-muted text-xs">
        For instances fronted by a
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
          value={settings.pangolinApiBaseUrl ?? ""}
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
          value={settings.pangolinOrgId ?? ""}
        />
      </div>
      <div>
        <label class={label} for="pangolinMainSiteName">Site name</label>
        <Input
          class=""
          id="pangolinMainSiteName"
          name="pangolinMainSiteName"
          type="text"
          value={settings.pangolinMainSiteName ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The Pangolin site (tunnel agent) whose host runs this instance's
          own Traefik. Must already exist in Pangolin, and is
          <strong>required</strong> : with it blank the integration stays off
          and no resource is ever created.
        </p>
      </div>
      <div class="grid gap-4 sm:grid-cols-2">
        <div class="sm:col-span-2">
          <label class={label} for="pangolinNewtEndpoint">Newt endpoint</label>
          <Input
            id="pangolinNewtEndpoint"
            name="pangolinNewtEndpoint"
            placeholder="https://pangolin.example.com"
            type="text"
            value={settings.pangolinNewtEndpoint ?? ""}
          />
          <p class="text-text-subtle mt-1.5 text-xs">
            Fill in the endpoint, ID and secret from the site's page in Pangolin
            and Homerun runs its own Newt tunnel client on this host, next to
            Traefik. It isn't a service, so it doesn't appear in your services
            list, and saving here recreates it. Leave all three blank when Newt
            runs somewhere else.
          </p>
        </div>
        <div>
          <label class={label} for="pangolinNewtId">Newt ID</label>
          <Input
            id="pangolinNewtId"
            name="pangolinNewtId"
            type="text"
            value={settings.pangolinNewtId ?? ""}
          />
        </div>
        <div>
          <label class={label} for="pangolinNewtSecret">Newt secret</label>
          <Input
            id="pangolinNewtSecret"
            name="pangolinNewtSecret"
            placeholder={settings.pangolinNewtSecretEnc ? "Unchanged" : ""}
            type="password"
          />
        </div>
      </div>
      <AsyncBlock
        errorTitle="Couldn't check this host for a tunnel client."
        query={newt}
      >
        {#snippet pending()}
          <Skeleton class="h-9 w-full" />
        {/snippet}
        {#snippet children(container)}
          {#if container}
            <p class="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-400">
              <span class="size-1.5 rounded-full {container.state === 'running'
              ? 'bg-emerald-500'
              : 'bg-amber-500'}"></span>
              {container.service === "newt"
              ? "Homerun's Newt tunnel client"
              : "A Pangolin tunnel client"} is on this host
              (<code class="font-mono">{container.image}</code>, {container.state}).
            </p>
          {:else}
            <p class="text-text-subtle rounded-lg border border-border px-3 py-2 text-xs">
              No Newt tunnel container found on this host. Pangolin can only
              reach services here through one : fill in the Newt fields above,
              or run your own.
            </p>
          {/if}
        {/snippet}
      </AsyncBlock>

      <div>
        <label class={label} for="pangolinTargetHost">Target host</label>
        <Input
          id="pangolinTargetHost"
          name="pangolinTargetHost"
          placeholder="Detected automatically"
          type="text"
          value={settings.pangolinTargetHost ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The address the Pangolin site agent reaches Traefik at. Unset means
          detected: Traefik's container name when Newt runs as a container on
          the same network, <code>localhost</code> when it runs on this host
          with host networking. Set it when Newt runs on another machine.
        </p>
      </div>

      <div>
        <label class={label} for="pangolinTargetPort">Target port</label>
        <Input
          id="pangolinTargetPort"
          name="pangolinTargetPort"
          placeholder="443"
          type="number"
          value={settings.pangolinTargetPort ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The local port on that site's host a Resource's Target forwards to:
          the host port Traefik's 443 is published on. Ignored when the target
          host is detected as Traefik's container name, which is always
          reached on 443.
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
          placeholder={settings.pangolinOrgId ? "Unchanged" : ""}
          type="password"
        />
      </div>
      <CheckBox
        checked={settings.pangolinOwnsAuth ?? false}
        helperText="Resources keep Pangolin's own SSO, and this instance's per-service login wall steps aside for anything Pangolin publishes : one sign-in instead of two. Off, Homerun owns access and every Resource it creates has Pangolin SSO disabled."
        id="pangolinOwnsAuth"
        label="Let Pangolin handle sign-in"
        name="pangolinOwnsAuth"
      />

      <div class="flex justify-end gap-2">
        <Button formaction="?/testPangolin" type="submit" variant="outline">
          Test connection
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>
