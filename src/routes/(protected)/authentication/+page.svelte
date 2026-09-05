<script lang="ts">
	import {
		ExternalLink,
		KeyRound,
		LockKeyhole,
		Plus,
		Trash2,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { OAUTH_PRESETS, type OauthPreset } from "$lib/auth-providers";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { title } from "$lib/store/title";
	import { saveToast } from "$lib/toast";

	const { data, form } = $props();

	interface OauthRow {
		clientId: string;
		clientSecret: string;
		discoveryUrl: string;
		enabled: boolean;
		hasSecret: boolean;
		name: string;
		pkce: boolean;
		scopes: string;
		templateHint: string;
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
			templateHint: "",
		};
	}

	let oauthRows = $state<OauthRow[]>(
		untrack(() => data.settings.oauthProviders.map(toRow)),
	);
	$effect(() => {
		oauthRows = data.settings.oauthProviders.map(toRow);
	});

	onMount(() => title.set("Authentication"));

	function uniqueName(base: string): string {
		if (!oauthRows.some((row) => row.name === base)) {
			return base;
		}
		let n = 2;
		while (oauthRows.some((row) => row.name === `${base}-${n}`)) {
			n += 1;
		}
		return `${base}-${n}`;
	}

	function addPreset(preset: OauthPreset) {
		oauthRows.push({
			clientId: "",
			clientSecret: "",
			discoveryUrl: preset.template,
			enabled: true,
			hasSecret: false,
			name: uniqueName(preset.id),
			pkce: preset.pkce,
			scopes: preset.scopes.join(", "),
			templateHint: preset.templateHint,
		});
	}

	function addBlankRow() {
		oauthRows.push({
			clientId: "",
			clientSecret: "",
			discoveryUrl: "",
			enabled: true,
			hasSecret: false,
			name: "",
			pkce: true,
			scopes: "openid, profile, email",
			templateHint: "",
		});
	}

	function removeOauthRow(i: number) {
		oauthRows.splice(i, 1);
	}
</script>

<div class="mx-auto max-w-4xl space-y-6 p-6">
  <div>
    <h1 class="text-text text-xl font-semibold">Authentication</h1>
    <p class="text-text-muted mt-1 text-sm">
      Who can sign in to Homerun, and which of those methods each protected app
      accepts. Saving rebuilds the auth backend live, no restart needed.
    </p>
  </div>

  {#if form?.error}
    <p class="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
      {form.error}
    </p>
  {/if}

  <!-- ═══ Built-in ═══ -->
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Built-in authentication</h2>
      <p class="text-text-muted text-xs">
        Homerun's own email and password accounts, managed on the Users page.
      </p>
    </div>
    <div class="space-y-2 p-5 text-sm">
      <p class="text-text-muted">
        Always available for signing in to the dashboard, and selectable
        per-app as the
        <span class="font-mono text-xs">password</span>
        method. Accounts are created by an admin
        {#if data.smtpEnabled}
          (direct-create or email invite).
        {:else}
          (direct-create : email invites need SMTP configured under Settings →
          Email).
        {/if}
      </p>
      <Button href={resolve("/users")} size="sm" variant="outline">
        Manage users
      </Button>
    </div>
  </section>

  <!-- ═══ OAuth / OIDC ═══ -->
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">OAuth / OIDC providers</h2>
      <p class="text-text-muted text-xs">
        Any generic OIDC provider : used both for signing into Homerun itself
        and, per app, for the login wall on a service with "Require login"
        (its Networking tab).
      </p>
    </div>

    <div class="border-border border-b px-5 py-4">
      <p class={label}>Start from a preset</p>
      <div class="flex flex-wrap gap-2">
        {#each OAUTH_PRESETS as preset (preset.id)}
          <Button onclick={() => addPreset(preset)} size="sm" variant="outline">
            <Plus class="size-3.5" />
            {preset.label}
          </Button>
        {/each}
        <Button onclick={addBlankRow} size="sm" variant="ghost">
          <Plus class="size-3.5" />
          Blank
        </Button>
      </div>
      <p class="text-text-subtle mt-2 text-xs">
        A preset fills in the discovery URL shape, scopes and PKCE default for
        that product. Replace the
        <span class="font-mono">{"{placeholders}"}</span>
        with your own values, then add the client id and secret from the OAuth
        app you registered there.
      </p>
      {#if data.callbackBase}
        <p class="text-text-subtle mt-2 text-xs">
          Redirect URI to register with your provider:
          <span class="text-accent font-mono">
            {data.callbackBase}/api/v1/auth/callback/&lt;provider id&gt;
          </span>
        </p>
      {:else}
        <p class="mt-2 text-xs text-amber-600">
          Set Origin under Settings → General so this page can show you the
          exact redirect URI to register with your provider.
        </p>
      {/if}
    </div>

    <form
      action="?/updateOauth"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={saveToast("OAuth providers")}
    >
      {#if oauthRows.length === 0}
        <p class="text-text-muted text-sm">
          No providers yet. Pick a preset above, or add a blank one.
        </p>
      {/if}

      {#each oauthRows as row, i (i)}
        <div class="border-border space-y-3 rounded-xl border p-4">
          <div class="flex items-center justify-between">
            <div class="text-text-muted flex items-center gap-2">
              <KeyRound class="size-4" />
              <span class="text-xs font-medium tracking-wide uppercase">
                {row.name || `Provider ${i + 1}`}
              </span>
              {#if data.usageByProvider[row.name]}
                <span class="text-text-subtle text-xs normal-case">
                  · used by {data.usageByProvider[row.name]} app{data
                    .usageByProvider[row.name] === 1
                  ? ""
                  : "s"}
                </span>
              {/if}
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
              <p class="text-text-subtle mt-1.5 text-xs">
                Referenced by each app's allowed sign-in methods, and part of
                the redirect URI. Renaming it drops it from any app already
                using it.
              </p>
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
              <label class={label} for="oauthClientSecret-{i}">
                Client secret
              </label>
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
              <label class={label} for="oauthDiscoveryUrl-{i}">
                Discovery URL
              </label>
              <Input
                class="font-mono"
                id="oauthDiscoveryUrl-{i}"
                name="oauthDiscoveryUrl"
                placeholder="https://provider.example.com/.well-known/openid-configuration"
                type="text"
                bind:value={row.discoveryUrl}
              />
              {#if row.templateHint}
                <p class="text-text-subtle mt-1.5 text-xs">{row.templateHint}</p>
              {/if}
            </div>
            <div class="sm:col-span-2">
              <label class={label} for="oauthScopes-{i}">
                Scopes (comma-separated)
              </label>
              <Input
                class="font-mono"
                id="oauthScopes-{i}"
                name="oauthScopes"
                placeholder="openid, email, profile"
                type="text"
                bind:value={row.scopes}
              />
              <p class="text-text-subtle mt-1.5 text-xs">
                Include the scope that carries group/role claims (often
                <span class="font-mono">groups</span>) if you want to restrict
                an app by group.
              </p>
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

      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <!-- ═══ Protected apps ═══ -->
  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Protected apps</h2>
      <p class="text-text-muted text-xs">
        Services with "Require login" turned on. Which methods each one accepts,
        and who's allowed through, is configured on that service's Networking
        tab.
      </p>
    </div>
    {#if data.gatedServices.length === 0}
      <p class="text-text-muted p-5 text-sm">
        No app is behind the login wall yet. Turn on "Require login" on a
        service's Networking tab to add one.
      </p>
    {:else}
      <div class="divide-border divide-y">
        {#each data.gatedServices as svc (svc.id)}
          <a
            class="hover:bg-surface-2 flex items-center gap-3 px-5 py-3"
            href="{resolve('/services')}/{svc.id}/networking"
          >
            <LockKeyhole class="text-accent size-4 shrink-0" />
            <div class="min-w-0 flex-1">
              <p class="text-text truncate text-sm font-medium">{svc.name}</p>
              <p class="text-text-subtle truncate font-mono text-xs">
                {#if svc.methods.length === 0}
                  no sign-in method picked yet : nobody can get in
                {:else}
                  {svc.methods.join(", ")}
                {/if}
              </p>
            </div>
            <ExternalLink class="text-text-subtle size-3.5 shrink-0" />
          </a>
        {/each}
      </div>
    {/if}
  </section>
</div>
