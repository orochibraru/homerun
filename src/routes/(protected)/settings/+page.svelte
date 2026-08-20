<script lang="ts">
  import { KeyRound, Plus, Trash2 } from "@lucide/svelte";
  import type { SubmitFunction } from "@sveltejs/kit";
  import { onMount } from "svelte";
  import { toast } from "svelte-sonner";
  import { enhance } from "$app/forms";
  import { page } from "$app/state";
  import CheckBox from "$lib/components/check-box.svelte";
  import {
    inputClass as input,
    labelClass as label,
  } from "$lib/components/form-styles";
  import { title } from "$lib/store/title";

  const { data, form } = $props();

  // Field ids the dashboard's setup-issue banner deep-linked here for —
  // see SETUP_CHECK_FIELDS in $lib/server/setup-checks.ts.
  const highlighted = $derived(
    new Set(
      (page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean)
    )
  );
  function highlightClass(field: string): string {
    return highlighted.has(field) ? "ring-2 ring-amber-400" : "";
  }

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

  let oauthRows = $state<OauthRow[]>(
    data.settings.oauthProviders.length > 0
      ? data.settings.oauthProviders.map(toRow)
      : []
  );

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
              "Check the form for errors."
          );
        }
        await update();
      };
  }
</script>

<div class="p-6 md:p-8">
  <div class="mb-8">
    <h1 class="text-2xl font-bold text-text">Settings</h1>
    <p class="mt-1 text-sm text-text-muted">
      Instance-wide configuration — stored in the database and applied live, no
      restart needed. Leave a field blank to fall back to its env-var default
      (shown as the placeholder); env vars still work for anyone bootstrapping
      via docker-compose before ever visiting this page.
    </p>
  </div>

  {#if form?.error}
    <p class="mb-6 text-sm text-red-500">{form.error}</p>
  {/if}

  <div class="space-y-6">
    <!-- ═══ Core ═══ -->
    <section class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">Core</h2>
        <p class="text-xs text-text-muted">
          Base domain, origin, and the auth-gate check URL.
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
          <input
            class="{input} {highlightClass('baseDomain')}"
            id="baseDomain"
            name="baseDomain"
            placeholder={data.envDefaults.baseDomain}
            type="text"
            value={data.settings.baseDomain ?? ""}
          >
          <p class="mt-1.5 text-xs text-text-subtle">
            Deployed services are routed under &lt;slug&gt;.&lt;this&gt;.
          </p>
        </div>
        <div>
          <label class={label} for="authOrigin">Origin URL</label>
          <input
            class="{input} {highlightClass('authOrigin')}"
            id="authOrigin"
            name="authOrigin"
            placeholder={data.envDefaults.authOrigin}
            type="text"
            value={data.settings.authOrigin ?? ""}
          >
          <p class="mt-1.5 text-xs text-text-subtle">
            Display-only today — better-auth's own baseURL still reads the
            <code>ORIGIN</code>
            env var directly (not this override), to avoid changing its dev-mode
            request-derived-origin behavior. Set
            <code>ORIGIN</code>
            for anything that actually depends on it.
          </p>
        </div>
        <div>
          <label class={label} for="authCheckUrl">Auth-check URL</label>
          <input
            class={input}
            id="authCheckUrl"
            name="authCheckUrl"
            placeholder={data.envDefaults.authCheckUrl}
            type="text"
            value={data.settings.authCheckUrl ?? ""}
          >
          <p class="mt-1.5 text-xs text-text-subtle">
            What Traefik's forwardAuth middleware calls to gatekeep a "Require
            login" service — must be reachable from inside the Traefik
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
          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all"
            type="submit"
          >
            Save
          </button>
        </div>
      </form>
    </section>

    <!-- ═══ Docker ═══ -->
    <section class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">Docker</h2>
        <p class="text-xs text-text-muted">
          The default local connection — separate from the per-service "Deploy
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
          <input
            class="{input} font-mono {highlightClass('dockerSocketPath')}"
            id="dockerSocketPath"
            name="dockerSocketPath"
            placeholder={data.envDefaults.dockerSocketPath}
            type="text"
            value={data.settings.dockerSocketPath ?? ""}
          >
        </div>
        <div>
          <label class={label} for="dockerNetworkName"
            >Shared network name</label
          >
          <input
            class="{input} font-mono"
            id="dockerNetworkName"
            name="dockerNetworkName"
            placeholder={data.envDefaults.dockerNetworkName}
            type="text"
            value={data.settings.dockerNetworkName ?? ""}
          >
        </div>
        <div class="flex justify-end">
          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all"
            type="submit"
          >
            Save
          </button>
        </div>
      </form>
    </section>

    <!-- ═══ Traefik ═══ -->
    <section class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">Traefik</h2>
        <p class="text-xs text-text-muted">
          Entrypoint, cert resolver, and the custom-SSL dynamic-config
          directory.
        </p>
      </div>
      <form
        action="?/updateTraefik"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={submitToast("Traefik settings")}
      >
        <div>
          <label class={label} for="traefikEntrypoint">Entrypoint</label>
          <input
            class={input}
            id="traefikEntrypoint"
            name="traefikEntrypoint"
            placeholder={data.envDefaults.traefikEntrypoint}
            type="text"
            value={data.settings.traefikEntrypoint ?? ""}
          >
        </div>
        <div>
          <label class={label} for="traefikCertResolver">Cert resolver</label>
          <input
            class={input}
            id="traefikCertResolver"
            name="traefikCertResolver"
            placeholder={data.envDefaults.traefikCertResolver}
            type="text"
            value={data.settings.traefikCertResolver ?? ""}
          >
        </div>
        <div>
          <label class={label} for="traefikDynamicConfigDir"
            >Dynamic config directory</label
          >
          <input
            class="{input} font-mono"
            id="traefikDynamicConfigDir"
            name="traefikDynamicConfigDir"
            placeholder={data.envDefaults.traefikDynamicConfigDir ?? "unset — custom SSL is a no-op"}
            type="text"
            value={data.settings.traefikDynamicConfigDir ?? ""}
          >
          <p class="mt-1.5 text-xs text-text-subtle">
            Must match the path bind-mounted into the Traefik container — see
            compose.yaml's commented-out example. Unset means per-service custom
            SSL certs are stored but never written anywhere.
          </p>
        </div>
        <div class="flex justify-end">
          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all"
            type="submit"
          >
            Save
          </button>
        </div>
      </form>
    </section>

    <!-- ═══ SMTP ═══ -->
    <section class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">Email (SMTP)</h2>
        <p class="text-xs text-text-muted">
          Used for email verification on sign-up.
        </p>
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
            <input
              class="{input} {highlightClass('smtpHost')}"
              id="smtpHost"
              name="smtpHost"
              placeholder={data.envDefaults.smtpHost ?? "smtp.example.com"}
              type="text"
              value={data.settings.smtpHost ?? ""}
            >
          </div>
          <div>
            <label class={label} for="smtpPort">Port</label>
            <input
              class="{input} {highlightClass('smtpPort')}"
              id="smtpPort"
              name="smtpPort"
              placeholder={data.envDefaults.smtpPort?.toString() ?? "587"}
              type="text"
              value={data.settings.smtpPort ?? ""}
            >
          </div>
          <div>
            <label class={label} for="smtpUser">Username</label>
            <input
              class="{input} {highlightClass('smtpUser')}"
              id="smtpUser"
              name="smtpUser"
              placeholder={data.envDefaults.smtpUser ?? ""}
              type="text"
              value={data.settings.smtpUser ?? ""}
            >
          </div>
          <div>
            <label class={label} for="smtpPassword">Password</label>
            <input
              class="{input} {highlightClass('smtpPassword')}"
              id="smtpPassword"
              name="smtpPassword"
              placeholder={data.settings.smtpPasswordEnc ? "Leave blank to keep current" : "Password"}
              type="password"
            >
          </div>
          <div>
            <label class={label} for="smtpFrom">From address</label>
            <input
              class="{input} {highlightClass('smtpFrom')}"
              id="smtpFrom"
              name="smtpFrom"
              placeholder={data.envDefaults.smtpFrom ?? "no-reply@example.com"}
              type="text"
              value={data.settings.smtpFrom ?? ""}
            >
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
          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all"
            type="submit"
          >
            Save
          </button>
        </div>
      </form>
    </section>

    <!-- ═══ OAuth Providers ═══ -->
    <section class="rounded-2xl border border-border bg-surface">
      <div class="border-b border-border px-5 py-4">
        <h2 class="text-sm font-semibold text-text">OAuth Providers</h2>
        <p class="text-xs text-text-muted">
          Any generic OIDC provider — used both for signing into Homerun itself
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
          <div class="space-y-3 rounded-xl border border-border p-4">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2 text-text-muted">
                <KeyRound class="size-4" />
                <span class="text-xs font-medium uppercase tracking-wide"
                  >Provider {i + 1}</span
                >
              </div>
              <button
                aria-label="Remove provider"
                class="rounded-lg p-1.5 text-red-500 transition-all hover:bg-red-500/10"
                onclick={() => removeOauthRow(i)}
                type="button"
              >
                <Trash2 class="size-4" />
              </button>
            </div>
            <div class="grid gap-3 sm:grid-cols-2">
              <div>
                <label class={label} for="oauthName-{i}">Provider id</label>
                <input
                  class="{input} font-mono"
                  id="oauthName-{i}"
                  name="oauthName"
                  placeholder="my-oidc-provider"
                  type="text"
                  bind:value={row.name}
                >
              </div>
              <div>
                <label class={label} for="oauthClientId-{i}">Client id</label>
                <input
                  class={input}
                  id="oauthClientId-{i}"
                  name="oauthClientId"
                  type="text"
                  bind:value={row.clientId}
                >
              </div>
              <div>
                <label class={label} for="oauthClientSecret-{i}"
                  >Client secret</label
                >
                <input
                  class={input}
                  id="oauthClientSecret-{i}"
                  name="oauthClientSecret"
                  placeholder={row.hasSecret ? "Leave blank to keep current" : "Client secret"}
                  type="password"
                  bind:value={row.clientSecret}
                >
              </div>
              <div>
                <label class={label} for="oauthDiscoveryUrl-{i}"
                  >Discovery URL</label
                >
                <input
                  class="{input} font-mono"
                  id="oauthDiscoveryUrl-{i}"
                  name="oauthDiscoveryUrl"
                  placeholder="https://provider.example.com/.well-known/openid-configuration"
                  type="text"
                  bind:value={row.discoveryUrl}
                >
              </div>
              <div class="sm:col-span-2">
                <label class={label} for="oauthScopes-{i}"
                  >Scopes (comma-separated)</label
                >
                <input
                  class="{input} font-mono"
                  id="oauthScopes-{i}"
                  name="oauthScopes"
                  placeholder="openid, email, profile"
                  type="text"
                  bind:value={row.scopes}
                >
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
                 unchecked) — keeps every oauth*[] field positionally
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

        <button
          class="text-accent flex items-center gap-1.5 text-sm font-medium hover:underline"
          onclick={addOauthRow}
          type="button"
        >
          <Plus class="size-3.5" />
          Add provider
        </button>

        <div class="flex justify-end">
          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark rounded-xl px-4 py-2 text-sm font-semibold text-white shadow-sm transition-all"
            type="submit"
          >
            Save
          </button>
        </div>
      </form>
    </section>
  </div>
</div>
