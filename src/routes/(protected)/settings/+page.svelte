<script lang="ts">
	import {
		Container,
		Globe,
		KeyRound,
		Mail,
		Network,
		Plus,
		Trash2,
	} from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { onMount, untrack } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import TabNav, { type NavTab } from "$lib/components/tab-nav.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	// Seeded once from the initial load : untrack() is intentional, not a
	// lint workaround (same pattern as the dashboard's systemStats seed).
	let autoscaleOverflowRemoteHostId = $state(
		untrack(() => data.settings.autoscaleOverflowRemoteHostId ?? ""),
	);
	const autoscaleOverflowRemoteHostLabel = $derived(
		data.remoteHosts.find((h) => h.id === autoscaleOverflowRemoteHostId)
			?.name ?? "Choose a remote host…",
	);
	let orchestrationMode = $state(
		untrack(() => data.settings.orchestrationMode ?? "standalone"),
	);

	// Field ids the dashboard's setup-issue banner deep-linked here for :
	// see AdminService.SETUP_CHECK_FIELDS in $lib/services/admin.service.ts.
	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);
	function highlightClass(field: string): string {
		return highlighted.has(field) ? "ring-2 ring-amber-400" : "";
	}
	/** The live setup-check message for a highlighted field, if any : see the load's `fieldIssues`. */
	function issueFor(field: string): string | undefined {
		return highlighted.has(field) ? data.fieldIssues[field] : undefined;
	}

	/** Which tab a given /settings field id lives on : drives the setup-issue banner's deep-link (see AdminService.SETUP_CHECK_FIELDS). */
	const FIELD_TAB: Record<string, string> = {
		authCheckUrl: "general",
		authCrossSubdomainCookies: "general",
		baseDomain: "general",
		dockerNetworkName: "docker",
		dockerSocketPath: "docker",
		smtpFrom: "email",
		smtpHost: "email",
		smtpPassword: "email",
		smtpPort: "email",
		smtpUser: "email",
	};

	// Categorized so the page is actually skimmable instead of one long
	// scroll of every section : each maps to a real settings group, not an
	// arbitrary split. Sections stay mounted (toggled via the `hidden`
	// attribute, not {#if}), same "hide, don't unmount" approach services/
	// new's step wizard uses, so switching tabs never loses in-progress
	// field edits or the oauthRows/autoscale $state seeded below.
	//
	// `hasWarning` (a small dot next to the tab label, see TabNav) is what
	// makes a setup issue on a tab you're *not* looking at discoverable at
	// all : real, tested-in-review gap this fixes, an amber ring around a
	// field on a hidden tab was previously invisible with nothing pointing
	// at it, easy to miss entirely once the page moved off one long scroll.
	const settingsTabs: NavTab[] = $derived(
		[
			{ icon: Globe, id: "general", label: "General" },
			{ icon: Container, id: "docker", label: "Docker" },
			{ icon: Network, id: "networking", label: "Networking" },
			{ icon: Mail, id: "email", label: "Email" },
			{ icon: KeyRound, id: "authentication", label: "Authentication" },
		].map((tab) => ({
			...tab,
			hasWarning: Object.keys(data.fieldIssues).some(
				(field) => FIELD_TAB[field] === tab.id,
			),
		})),
	);

	let activeTab = $state(
		untrack(() => {
			for (const field of highlighted) {
				const tab = FIELD_TAB[field];
				if (tab) {
					return tab;
				}
			}
			return "general";
		}),
	);

	onMount(() => {
		title.set("Settings");
		const [first] = highlighted;
		if (first) {
			document
				.getElementById(first)
				?.scrollIntoView({ behavior: "smooth", block: "center" });
		}
	});

	interface OauthRow {
		clientId: string;
		clientSecret: string;
		discoveryUrl: string;
		enabled: boolean;
		hasSecret: boolean;
		name: string;
		pkce: boolean;
		scopes: string;
	}

	function toRow(p: (typeof data.settings.oauthProviders)[number]): OauthRow {
		return {
			clientId: p.clientId,
			clientSecret: "",
			discoveryUrl: p.discoveryUrl,
			enabled: p.enabled,
			hasSecret: !!p.clientSecretEnc,
			name: p.name,
			pkce: p.pkce,
			scopes: p.scopes.join(", "),
		};
	}

	// $state, not $derived: this array is pushed/spliced into directly below
	// (addOauthRow/removeOauthRow) and its rows are bound two-way via
	// bind:value, a $derived value is read-only, so mutating it doesn't
	// stick (it's still driven by its source expression), which is why
	// "Add provider" previously did nothing observable. Seeded once at
	// component init; re-synced below whenever `data` actually changes
	// (a real save, or navigating here again) rather than on every
	// keystroke, so in-progress edits aren't clobbered mid-typing.
	let oauthRows = $state<OauthRow[]>(
		untrack(() => data.settings.oauthProviders.map(toRow)),
	);
	$effect(() => {
		oauthRows = data.settings.oauthProviders.map(toRow);
	});

	function addOauthRow() {
		oauthRows.push({
			clientId: "",
			clientSecret: "",
			discoveryUrl: "",
			enabled: true,
			hasSecret: false,
			name: "",
			pkce: true,
			scopes: "",
		});
	}

	function removeOauthRow(i: number) {
		oauthRows.splice(i, 1);
	}

	function submitToast(sectionLabel: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === "success") {
					toast.success(`${sectionLabel} saved.`);
				} else if (result.type === "failure") {
					toast.error(
						(result.data as { error?: string })?.error ??
							"Check the form for errors.",
					);
				}
				await update();
			};
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8">
    <h1 class="text-text text-2xl font-bold">Settings</h1>
    <p class="text-text-muted mt-1 text-sm">
      Instance-wide configuration : stored in the database and applied live, no
      restart needed. Leave a field blank to fall back to its env-var default
      (shown as the placeholder); env vars still work for anyone bootstrapping
      via docker-compose before ever visiting this page.
    </p>
  </div>

  {#if form?.error}
    <p class="mb-6 text-sm text-red-500">{form.error}</p>
  {/if}

  <TabNav
    active={activeTab}
    onSelect={(id) => {
      activeTab = id;
    }}
    tabs={settingsTabs}
  />

  <div class="space-y-6">
    <!-- ═══ Core ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "general"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Core</h2>
        <p class="text-text-muted text-xs">
          Base domain and the auth-gate check URL.
        </p>
      </div>
      <form
        action="?/updateCore"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("Core settings")}
      >
        <div>
          <label class={label} for="baseDomain">Base domain</label>
          <Input
            class={highlightClass("baseDomain")}
            id="baseDomain"
            name="baseDomain"
            placeholder={data.envDefaults.baseDomain}
            type="text"
            value={data.settings.baseDomain ?? ""}
          />
          <p class="text-text-subtle mt-1.5 text-xs">
            A bare hostname, e.g. <code class="font-mono">example.com</code>
            or <code class="font-mono">app.example.local</code> : no
            <code class="font-mono">https://</code>, path, or trailing slash.
            Deployed services are routed under &lt;slug&gt;.&lt;this&gt;, and
            this app's own origin below is derived from it, so this one field
            is all that's needed.
          </p>
          {#if issueFor("baseDomain")}
            <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              ⚠ {issueFor("baseDomain")}
            </p>
          {/if}
        </div>
        <CheckBox
          checked={data.settings.authOrigin
          ? data.settings.authOrigin.startsWith("https://")
          : true}
          helperText={`Origin: ${
            data.settings.authOrigin ??
            (data.settings.baseDomain
              ? `https://${data.settings.baseDomain}`
              : (data.envDefaults.authOrigin ?? "derived per-request until a base domain is set"))
          }`}
          id="useHttps"
          label="Use HTTPS"
          name="useHttps"
        />
        <div>
          <label class={label} for="authCheckUrl">Auth-check URL</label>
          <Input
            id="authCheckUrl"
            name="authCheckUrl"
            placeholder={data.envDefaults.authCheckUrl}
            type="text"
            value={data.settings.authCheckUrl ?? ""}
          />
          <p class="text-text-subtle mt-1.5 text-xs">
            What Traefik's forwardAuth middleware calls to gatekeep a "Require
            login" service : must be reachable from inside the Traefik
            container.
          </p>
        </div>
        <CheckBox
          checked={data.settings.authCrossSubdomainCookies ?? false}
          helperText="Widens the session cookie to every subdomain of the base domain"
          id="authCrossSubdomainCookies"
          label="Cross-subdomain cookies"
          name="authCrossSubdomainCookies"
        />
        <div class="flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>

    <!-- ═══ Docker ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "docker"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Docker</h2>
        <p class="text-text-muted text-xs">
          The default local connection : separate from the per-service "Deploy
          target" picker on Remote Hosts.
        </p>
      </div>
      <form
        action="?/updateDocker"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("Docker settings")}
      >
        <div>
          <label class={label} for="dockerSocketPath">Socket path</label>
          <Input
            class="font-mono {highlightClass('dockerSocketPath')}"
            id="dockerSocketPath"
            name="dockerSocketPath"
            placeholder={data.envDefaults.dockerSocketPath}
            type="text"
            value={data.settings.dockerSocketPath ?? ""}
          />
          {#if issueFor("dockerSocketPath")}
            <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
              ⚠ {issueFor("dockerSocketPath")}
            </p>
          {/if}
        </div>
        <div>
          <label class={label} for="dockerNetworkName"
          >Shared network name</label>
          <Input
            class="font-mono"
            id="dockerNetworkName"
            name="dockerNetworkName"
            placeholder={data.envDefaults.dockerNetworkName}
            type="text"
            value={data.settings.dockerNetworkName ?? ""}
          />
        </div>
        <div class="flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>

    <!-- ═══ Orchestration ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "docker"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Orchestration</h2>
        <p class="text-text-muted text-xs">
          "Standalone" is a single container per service (this app's original
          model). "Swarm" deploys every service as a replicated, self-healing
          Docker Swarm service instead : scale via the Replicas field on a
          service's Compute tab, restarts are rolling force-updates. Requires
          this host's own Docker daemon to already be swarm-active (<code
          >docker swarm init</code
          >, your own one-time step, this app never runs that itself) and
          Traefik configured with <code
          >--providers.docker.swarmMode=true</code
          >. Remote Hosts aren't part of the swarm cluster : a swarm-mode
          service can only deploy locally.
        </p>
      </div>
      <form
        action="?/updateOrchestration"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("Orchestration settings")}
      >
        <div>
          <label class={label} for="orchestrationMode">Mode</label>
          <SelectRoot
            name="orchestrationMode"
            type="single"
            bind:value={orchestrationMode}
          >
            <SelectTrigger id="orchestrationMode">
              {orchestrationMode === "swarm" ? "Swarm" : "Standalone"}
            </SelectTrigger>
            <SelectContent>
              <SelectItem label="Standalone" value="standalone" />
              <SelectItem label="Swarm" value="swarm" />
            </SelectContent>
          </SelectRoot>
        </div>
        <div class="flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>

    <!-- ═══ Autoscaling ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "docker"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Autoscaling</h2>
        <p class="text-text-muted text-xs">
          "GCP Cloud Run"-style load shedding : when this host crosses a
          resource threshold, one autoscale-eligible service (opt in from its
          Compute tab) gets migrated onto the overflow remote host below. This
          moves the service, it doesn't run a second replica of it : off by
          default, and inert unless both enabled here and opted into
          per-service.
        </p>
      </div>
      <form
        action="?/updateAutoscale"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("Autoscaling settings")}
      >
        <CheckBox
          checked={data.settings.autoscaleEnabled}
          helperText="Allow the autoscale scheduler to migrate eligible services off this host"
          id="autoscaleEnabled"
          label="Enable autoscaling"
          name="autoscaleEnabled"
        />
        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class={label} for="autoscaleCpuThresholdPercent">
              CPU threshold (%)
            </label>
            <Input
              id="autoscaleCpuThresholdPercent"
              max="99"
              min="1"
              name="autoscaleCpuThresholdPercent"
              type="number"
              value={data.settings.autoscaleCpuThresholdPercent}
            />
          </div>
          <div>
            <label class={label} for="autoscaleMemoryThresholdPercent">
              Memory threshold (%)
            </label>
            <Input
              id="autoscaleMemoryThresholdPercent"
              max="99"
              min="1"
              name="autoscaleMemoryThresholdPercent"
              type="number"
              value={data.settings.autoscaleMemoryThresholdPercent}
            />
          </div>
        </div>
        <div>
          <p class={label}>Overflow remote host</p>
          {#if data.remoteHosts.length === 0}
            <p class="text-text-subtle text-xs">
              No remote hosts registered yet : add one on the Remote Hosts page
              first.
            </p>
          {:else}
            <SelectRoot
              name="autoscaleOverflowRemoteHostId"
              type="single"
              bind:value={autoscaleOverflowRemoteHostId}
            >
              <SelectTrigger class="w-full">
                {autoscaleOverflowRemoteHostLabel}
              </SelectTrigger>
              <SelectContent>
                <SelectItem label="None" value="" />
                {#each data.remoteHosts as host (host.id)}
                  <SelectItem label={host.name} value={host.id} />
                {/each}
              </SelectContent>
            </SelectRoot>
          {/if}
        </div>
        <div class="flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>

    <!-- ═══ Traefik ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "networking"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Traefik</h2>
        <p class="text-text-muted text-xs">
          Entrypoint, cert resolver, ACME account email, and the custom-SSL
          dynamic-config directory.
        </p>
      </div>
      <form
        action="?/updateTraefik"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("Traefik settings")}
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

    <!-- ═══ Cloudflare ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "networking"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Cloudflare</h2>
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
        use:enhance={() => async ({ result, update }) => {
          if (result.type === "success") {
            toast.success(
              (result.data as { cloudflareTestOk?: boolean })?.cloudflareTestOk
              ? "Zone access verified."
              : "Cloudflare settings saved.",
            );
          } else if (result.type === "failure") {
            toast.error(
              (result.data as { error?: string })?.error
              ?? "Check the form for errors.",
            );
          }
          await update();
        }}
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

    <!-- ═══ Pangolin ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "networking"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Pangolin</h2>
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
        use:enhance={() => async ({ result, update }) => {
          if (result.type === "success") {
            toast.success(
              (result.data as { pangolinTestOk?: boolean })?.pangolinTestOk
              ? "Org access verified."
              : "Pangolin settings saved.",
            );
          } else if (result.type === "failure") {
            toast.error(
              (result.data as { error?: string })?.error
              ?? "Check the form for errors.",
            );
          }
          await update();
        }}
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

    <!-- ═══ SMTP ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "email"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">Email (SMTP)</h2>
        <p class="text-text-muted text-xs">
          Used for email verification on sign-up.
        </p>
        {#if issueFor("smtpHost")}
          <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            ⚠ {issueFor("smtpHost")}
          </p>
        {/if}
      </div>
      <form
        action="?/updateSmtp"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("SMTP settings")}
      >
        <CheckBox
          checked={data.settings.smtpEnabled ?? false}
          helperText="Send email through this SMTP server"
          id="smtpEnabled"
          label="Enabled"
          name="smtpEnabled"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <div>
            <label class={label} for="smtpHost">Host</label>
            <Input
              class={highlightClass("smtpHost")}
              id="smtpHost"
              name="smtpHost"
              placeholder={data.envDefaults.smtpHost ?? "smtp.example.com"}
              type="text"
              value={data.settings.smtpHost ?? ""}
            />
          </div>
          <div>
            <label class={label} for="smtpPort">Port</label>
            <Input
              class={highlightClass("smtpPort")}
              id="smtpPort"
              name="smtpPort"
              placeholder={data.envDefaults.smtpPort?.toString() ?? "587"}
              type="text"
              value={data.settings.smtpPort ?? ""}
            />
          </div>
          <div>
            <label class={label} for="smtpUser">Username</label>
            <Input
              class={highlightClass("smtpUser")}
              id="smtpUser"
              name="smtpUser"
              placeholder={data.envDefaults.smtpUser ?? ""}
              type="text"
              value={data.settings.smtpUser ?? ""}
            />
          </div>
          <div>
            <label class={label} for="smtpPassword">Password</label>
            <Input
              class={highlightClass("smtpPassword")}
              id="smtpPassword"
              name="smtpPassword"
              placeholder={data.settings.smtpPasswordEnc
              ? "Leave blank to keep current"
              : "Password"}
              type="password"
            />
          </div>
          <div>
            <label class={label} for="smtpFrom">From address</label>
            <Input
              class={highlightClass("smtpFrom")}
              id="smtpFrom"
              name="smtpFrom"
              placeholder={data.envDefaults.smtpFrom ?? "no-reply@example.com"}
              type="text"
              value={data.settings.smtpFrom ?? ""}
            />
          </div>
          <div class="sm:col-span-2">
            <CheckBox
              checked={data.settings.smtpSecure ?? false}
              helperText="Use TLS when connecting to the SMTP server"
              id="smtpSecure"
              label="Secure (TLS)"
              name="smtpSecure"
            />
          </div>
        </div>
        <div class="flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>

    <!-- ═══ OAuth Providers ═══ -->
    <section
      class="border-border bg-surface rounded-2xl border"
      hidden={activeTab !== "authentication"}
    >
      <div class="border-border border-b px-5 py-4">
        <h2 class="text-text text-sm font-semibold">OAuth Providers</h2>
        <p class="text-text-muted text-xs">
          Any generic OIDC provider : used both for signing into Homerun itself
          and for gating a service with "Require login" (Networking tab). Saving
          here rebuilds the auth backend live, no restart needed.
        </p>
      </div>
      <form
        action="?/updateOauth"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("OAuth providers")}
      >
        {#each oauthRows as row, i (i)}
          <div class="border-border space-y-3 rounded-xl border p-4">
            <div class="flex items-center justify-between">
              <div class="text-text-muted flex items-center gap-2">
                <KeyRound class="size-4" />
                <span
                  class="text-xs font-medium tracking-wide uppercase"
                >Provider {i + 1}</span>
              </div>
              <Button
                aria-label="Remove provider"
                class="text-red-500 hover:bg-red-500/10 hover:text-red-500"
                onclick={() => removeOauthRow(i)}
                size="icon-sm"
                variant="ghost"
              >
                <Trash2 class="size-4" />
              </Button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class={label} for="oauthName-{i}">Provider id</label>
                <Input
                  class="font-mono"
                  id="oauthName-{i}"
                  name="oauthName"
                  placeholder="my-oidc-provider"
                  type="text"
                  bind:value={row.name}
                />
              </div>
              <div>
                <label class={label} for="oauthClientId-{i}">Client id</label>
                <Input
                  id="oauthClientId-{i}"
                  name="oauthClientId"
                  type="text"
                  bind:value={row.clientId}
                />
              </div>
              <div>
                <label class={label} for="oauthClientSecret-{i}"
                >Client secret</label>
                <Input
                  id="oauthClientSecret-{i}"
                  name="oauthClientSecret"
                  placeholder={row.hasSecret
                  ? "Leave blank to keep current"
                  : "Client secret"}
                  type="password"
                  bind:value={row.clientSecret}
                />
              </div>
              <div>
                <label class={label} for="oauthDiscoveryUrl-{i}"
                >Discovery URL</label>
                <Input
                  class="font-mono"
                  id="oauthDiscoveryUrl-{i}"
                  name="oauthDiscoveryUrl"
                  placeholder="https://provider.example.com/.well-known/openid-configuration"
                  type="text"
                  bind:value={row.discoveryUrl}
                />
              </div>
              <div class="sm:col-span-2">
                <label class={label} for="oauthScopes-{i}"
                >Scopes (comma-separated)</label>
                <Input
                  class="font-mono"
                  id="oauthScopes-{i}"
                  name="oauthScopes"
                  placeholder="openid, email, profile"
                  type="text"
                  bind:value={row.scopes}
                />
              </div>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <CheckBox
                helperText="Allow signing in with this provider"
                id="oauthEnabledToggle-{i}"
                label="Enabled"
                name="oauthEnabledToggle-{i}"
                bind:checked={row.enabled}
              />
              <CheckBox
                helperText="Use PKCE for the OAuth code exchange"
                id="oauthPkceToggle-{i}"
                label="PKCE"
                name="oauthPkceToggle-{i}"
                bind:checked={row.pkce}
              />
            </div>
            <!-- Hidden mirrors of the two checkboxes above, always present
                 (unlike a real checkbox, which drops out of FormData when
                 unchecked) : keeps every oauth*[] field positionally
                 aligned across rows regardless of which boxes are checked. -->
            <input
              name="oauthEnabled"
              type="hidden"
              value={row.enabled ? "true" : "false"}
            >
            <input
              name="oauthPkce"
              type="hidden"
              value={row.pkce ? "true" : "false"}
            >
          </div>
        {/each}

        <Button class="h-auto p-0" onclick={addOauthRow} variant="link">
          <Plus class="size-3.5" />
          Add provider
        </Button>

        <div class="flex justify-end">
          <Button type="submit">Save</Button>
        </div>
      </form>
    </section>
  </div>
</div>
