<script lang="ts">
	import { Check, Link2, Minus, PlugZap, ShieldCheck } from "@lucide/svelte";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import CopyButton from "$lib/components/copy-button.svelte";
	import OauthAppCredentials from "$lib/components/oauth-app-credentials.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { formatDate, timeAgo } from "$lib/formatting";

	const { data } = $props();
	const app = $derived(data.app);

	const stats = $derived([
		{
			hint: "hold a consent or a live token",
			label: "Users",
			value: String(data.activity.users),
		},
		{
			hint: data.activity.lastUsedAt
				? new Date(data.activity.lastUsedAt).toLocaleString()
				: "no token issued yet",
			label: "Last used",
			value: data.activity.lastUsedAt
				? timeAgo(data.activity.lastUsedAt)
				: "Never",
		},
		{
			hint: app.skipConsent ? "signs straight in" : "asked once per user",
			label: "Consent screen",
			value: app.skipConsent ? "Skipped" : "Shown",
		},
		{
			hint: app.createdAt ? timeAgo(app.createdAt) : "",
			label: "Registered",
			value: formatDate(app.createdAt),
		},
	]);

	const behavior = $derived([
		{
			label: app.confidential
				? "Confidential: authenticates with its client secret"
				: "Public: no secret, for apps that run in the browser or on a phone",
			on: true,
		},
		{
			label:
				app.requirePkce || !app.confidential
					? "PKCE required"
					: "PKCE optional",
			on: app.requirePkce || !app.confidential,
		},
		{
			label: app.enableEndSession
				? "Can sign users out of Homerun (end session)"
				: "Can't sign users out of Homerun",
			on: app.enableEndSession,
		},
	]);
</script>

<div class="space-y-6">
  <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
    {#each stats as stat (stat.label)}
      <div class="panel rounded-md px-4 py-3" title={stat.hint}>
        <p class="eyebrow text-text-subtle">{stat.label}</p>
        <p class="text-text mt-1 text-lg font-semibold tracking-tight">{stat.value}</p>
        <p class="text-text-subtle truncate text-xs">{stat.hint}</p>
      </div>
    {/each}
  </div>

  {#if app.disabled}
    <Alert variant="warning">
      This app is off: it can't start new sign-ins. People already signed in
      keep their tokens until they expire. Turn it back on with the switch
      above.
    </Alert>
  {/if}

  {#if data.issuer}
    <section class="panel rounded-md">
      <PanelHeader
        description="What to paste into the app's OpenID Connect settings. Most apps only need the discovery URL, the client ID and the secret."
        icon={PlugZap}
        title="Connect the app"
      />
      <div class="p-5">
        <OauthAppCredentials clientId={app.clientId} issuer={data.issuer} />
        {#if app.confidential}
          <p class="text-text-subtle mt-4 text-xs">
            The client secret was shown once, when the app was registered.
            Lost it?
            <a
              class="text-accent hover:underline"
              href={resolve("/(protected)/idp/[appId]/settings", { appId: app.id })}
            >Rotate it in Settings</a>.
          </p>
        {/if}
      </div>
    </section>
  {:else}
    <Alert variant="warning">
      The Dashboard URL isn't set under Settings → General, so Homerun isn't
      acting as a provider right now and this app can't sign anyone in.
    </Alert>
  {/if}

  <div class="grid gap-6 lg:grid-cols-2">
    <section class="panel rounded-md">
      <PanelHeader
        description="Where Homerun may send someone back after they sign in. Anything else is refused."
        icon={Link2}
        title="Redirect URIs"
      />
      <ul class="divide-border divide-y">
        {#each app.redirectUris as uri (uri)}
          <li class="flex items-center gap-2 px-5 py-2.5">
            <code class="text-text min-w-0 flex-1 truncate font-mono text-xs">{uri}</code>
            <CopyButton label="redirect URI" value={uri} />
          </li>
        {/each}
      </ul>
    </section>

    <section class="panel rounded-md">
      <PanelHeader
        description="How sign-in through this app behaves. Change it in Settings."
        icon={ShieldCheck}
        title="Sign-in"
      />
      <ul class="space-y-2.5 p-5">
        {#each behavior as item (item.label)}
          <li class="flex items-start gap-2 text-sm">
            {#if item.on}
              <Check class="mt-0.5 size-4 shrink-0 text-emerald-500" />
            {:else}
              <Minus class="text-text-subtle mt-0.5 size-4 shrink-0" />
            {/if}
            <span class={item.on ? "text-text" : "text-text-muted"}>{item.label}</span>
          </li>
        {/each}
        <li class="flex flex-wrap items-center gap-1.5 pt-1">
          <span class="text-text-muted mr-1 text-xs">Scopes</span>
          {#each app.scopes.length > 0 ? app.scopes : ["openid", "profile", "email", "groups"] as scope (scope)}
            <span class="bg-surface-2 text-text-muted rounded px-1.5 py-0.5 font-mono text-[0.6875rem]">
              {scope}
            </span>
          {/each}
        </li>
      </ul>
    </section>
  </div>
</div>
