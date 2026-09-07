<script lang="ts">
	import {
		Check,
		Globe,
		LockKeyhole,
		Network,
		ShieldCheck,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
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
		data.projectSlug ? `${data.projectSlug}-${svc.slug}` : svc.slug,
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

	let submittingAuth = $state(false);
	let authRequired = $state(untrack(() => svc.authRequired));
	let methods = $state<string[]>(untrack(() => [...svc.authProviders]));
	let allowedUserIds = $state<string[]>(
		untrack(() => [...svc.authAllowedUserIds]),
	);

	$effect(() => {
		authRequired = svc.authRequired;
		methods = [...svc.authProviders];
		allowedUserIds = [...svc.authAllowedUserIds];
	});

	function toggleMethod(method: string, checked: boolean) {
		methods = checked
			? [...new Set([...methods, method])]
			: methods.filter((entry) => entry !== method);
	}

	function toggleUser(userId: string, checked: boolean) {
		allowedUserIds = checked
			? [...new Set([...allowedUserIds, userId])]
			: allowedUserIds.filter((entry) => entry !== userId);
	}
</script>

<div class="space-y-6">
  <!-- ═══ DNS / public routing ═══ -->
  <section class="glass rounded-2xl p-5">
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
          success: "Saved.",
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

        <Button disabled={submitting} type="submit" variant="outline">
          {#if submitting}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </form>
    {/if}
  </section>

  <!-- ═══ Access ═══ -->
  <section class="glass rounded-2xl p-5">
    <div class="mb-4 flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <LockKeyhole class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">Access</p>
        <p class="text-text-muted text-xs">
          {#if svc.authRequired}
            Visitors are sent to this instance's sign-in page before they reach
            this app.
          {:else}
            Open to anyone who can reach it.
          {/if}
        </p>
      </div>
    </div>

    {#if !svc.dnsResolvable}
      <p class="text-text-muted text-sm">
        Not applicable : this service isn't publicly routed, so it has no
        Traefik router to gate. Turn on DNS resolvability in the Network
        section below first.
      </p>
    {:else}
      <form
        action="?/updateAppAuth"
        class="space-y-4"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't save the access rules.",
          loading: "Saving access rules",
          onSettled: () => {
            submittingAuth = false;
          },
          onStart: () => {
            submittingAuth = true;
          },
          success: "Saved. Redeploy this service for it to take effect.",
        })}
      >
        {#if form?.authError}
          <p class="text-xs text-red-500">{form.authError}</p>
        {/if}

        <CheckBox
          helperText="Send anonymous visitors to Homerun's sign-in page instead of letting them through"
          id="authRequired"
          label="Require login to access this app"
          name="authRequired"
          bind:checked={authRequired}
        />

        {#if authRequired}
          {#if !data.dashboardOrigin}
            <p class="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
              Set Origin under Settings → General first. The login wall
              redirects visitors to this instance's own sign-in page, so
              Homerun has to know its own public URL to send them there.
            </p>
          {/if}

          <div class="border-border border-t pt-4">
            <p class={label}>Sign-in methods</p>
            <p class="text-text-subtle mb-2 text-xs">
              Nothing is enabled by default. Pick every method someone may use
              to get into this app.
            </p>
            <div class="space-y-2">
              <CheckBox
                checked={methods.includes("password")}
                helperText="Homerun's own email and password accounts"
                id="method-password"
                label="Built-in Homerun login"
                name="method-password"
                onCheckedChange={(v) => toggleMethod("password", v)}
              />
              {#each data.oauthProviders as provider (provider.method)}
                <CheckBox
                  checked={methods.includes(provider.method)}
                  helperText="OAuth / OIDC provider configured under Authentication"
                  id="method-{provider.name}"
                  label={provider.label}
                  name="method-{provider.name}"
                  onCheckedChange={(v) => toggleMethod(provider.method, v)}
                />
              {/each}
              {#if data.oauthProviders.length === 0}
                <p class="text-text-subtle text-xs">
                  No OAuth provider is enabled yet. Add one on the
                  <a class="text-accent" href={resolve("/authentication")}>
                    Authentication
                  </a>
                  page to offer it here.
                </p>
              {/if}
            </div>
            {#each methods as method (method)}
              <input name="authProvider" type="hidden" value={method}>
            {/each}
          </div>

          <div class="border-border border-t pt-4">
            <p class={label}>Who's allowed</p>
            <p class="text-text-subtle mb-3 text-xs">
              Leave all three empty to let any signed-in user through, as long
              as they used one of the methods above. Filling any of them
              narrows access to whoever matches at least one entry in that
              list.
            </p>

            <div class="space-y-3">
              <div>
                <p class="text-text mb-1.5 text-xs font-medium">Users</p>
                <div class="max-h-40 space-y-1.5 overflow-y-auto">
                  {#each data.users as u (u.id)}
                    <CheckBox
                      checked={allowedUserIds.includes(u.id)}
                      helperText={u.email}
                      id="user-{u.id}"
                      label={u.name}
                      name="user-{u.id}"
                      onCheckedChange={(v) => toggleUser(u.id, v)}
                    />
                  {/each}
                </div>
                {#each allowedUserIds as userId (userId)}
                  <input name="authAllowedUserId" type="hidden" value={userId}>
                {/each}
              </div>

              <div>
                <label class={label} for="authAllowedEmails">Emails</label>
                <Textarea
                  class="font-mono"
                  id="authAllowedEmails"
                  name="authAllowedEmails"
                  placeholder={"ada@example.com\n*@example.com"}
                  rows={3}
                  value={svc.authAllowedEmails.join("\n")}
                />
                <p class="text-text-subtle mt-1.5 text-xs">
                  One per line. A
                  <span class="font-mono">*@domain.com</span>
                  entry matches every address at that domain.
                </p>
              </div>

              <div>
                <label class={label} for="authAllowedGroups">
                  Groups / roles
                </label>
                <Textarea
                  class="font-mono"
                  id="authAllowedGroups"
                  name="authAllowedGroups"
                  placeholder={"platform-team\nadmins"}
                  rows={3}
                  value={svc.authAllowedGroups.join("\n")}
                />
                <p class="text-text-subtle mt-1.5 text-xs">
                  One per line, matched against the group and role claims in
                  the id token your OAuth provider issued
                  (<span class="font-mono">groups</span>,
                  <span class="font-mono">roles</span>, and Keycloak's realm and
                  resource roles). Make sure the provider's scopes actually
                  request them.
                </p>
              </div>
            </div>
          </div>
        {/if}

        <Button disabled={submittingAuth} type="submit" variant="outline">
          {#if submittingAuth}
            <Spinner />
          {:else}
            <Check class="size-4" />
          {/if}
          Save
        </Button>
      </form>
    {/if}
  </section>

  <!-- ═══ SSL ═══ -->
  <section class="glass rounded-2xl p-5">
    <div class="mb-4 flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <ShieldCheck class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">SSL</p>
        <p class="text-text-muted text-xs">
          {#if svc.dnsResolvable}
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
          success: "Saved.",
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
            class="resize-none font-mono"
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
            class="resize-none font-mono"
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
        <button
          class="border-border text-text hover:bg-surface-2 flex items-center gap-2 rounded-xl border px-4 py-2 text-sm font-medium transition-all disabled:cursor-not-allowed disabled:opacity-60"
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
      </form>
    {/if}
  </section>

  <!-- ═══ Network ═══ -->
  <section class="glass rounded-2xl p-5">
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
            <span class="text-text-subtle font-mono">{svc.slug}:{
                svc.containerPort
              }</span>.
          {:else}
            Container port
            <span class="text-text-subtle font-mono">{svc.containerPort}</span>
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
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Saved.",
      })}
    >
      <div>
        <div class={label}>Network mode</div>
        <div class="grid grid-cols-2 gap-3">
          <button
            class="
              flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all {networkMode ===
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
              flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-medium transition-all {networkMode ===
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
            Assistant). No shared/project network, no Traefik routing, no public
            DNS route regardless of the setting below.
          {:else}
            Joins the shared Traefik network (plus its project's network, if
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

      <Button disabled={submittingPorts} type="submit" variant="outline">
        {#if submittingPorts}
          <Spinner />
        {:else}
          <Check class="size-4" />
        {/if}
        Save
      </Button>
    </form>
  </section>
</div>
