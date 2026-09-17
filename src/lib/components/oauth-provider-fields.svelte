<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Input } from "$lib/components/ui/input/index.js";
	import * as Select from "$lib/components/ui/select/index.js";

	export interface ProviderFieldValues {
		clientId: string;
		discoveryUrl: string;
		enabled: boolean;
		hasSecret: boolean;
		label: string;
		name: string;
		pkce: boolean;
		scopes: string;
		signOutOfProvider: boolean;
		templateHint: string;
		tokenAuthMethod: string;
	}

	const TOKEN_AUTH_LABELS: Record<string, string> = {
		auto: "Automatic (follow the provider)",
		basic: "HTTP Basic header (basic)",
		post: "Client secret in body (post)",
	};

	const {
		callbackBase,
		nameLocked = false,
		values,
	}: {
		callbackBase: string | null;
		nameLocked?: boolean;
		values: ProviderFieldValues;
	} = $props();
</script>

<div class="space-y-4">
  <div class="grid gap-4 sm:grid-cols-2">
    <div>
      <label class={label} for="label">Display name</label>
      <Input
        id="label"
        name="label"
        placeholder="Pocket ID"
        type="text"
        bind:value={values.label}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        What people see on the sign-in button ("Continue with …") and wherever
        this provider is listed. Blank falls back to the id below.
      </p>
    </div>
    <div>
      <label class={label} for="name">Provider id</label>
      <Input
        class=""
        id="name"
        name="name"
        placeholder="pocket-id"
        readonly={nameLocked}
        type="text"
        bind:value={values.name}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        {#if nameLocked}
          Fixed once created : it's part of the redirect URI you registered, and
          what each app's allowed sign-in methods reference.
        {:else}
          Lowercase letters, digits and hyphens. It becomes part of the redirect
          URI, so pick it before registering the app with your provider.
        {/if}
      </p>
    </div>
    <div>
      <label class={label} for="clientId">Client id</label>
      <Input id="clientId" name="clientId" type="text" bind:value={values.clientId} />
    </div>
    <div>
      <label class={label} for="clientSecret">Client secret</label>
      <Input
        id="clientSecret"
        name="clientSecret"
        placeholder={values.hasSecret ? "Leave blank to keep current" : "Client secret"}
        type="password"
      />
    </div>
    <div class="sm:col-span-2">
      <label class={label} for="discoveryUrl">Discovery URL</label>
      <Input
        class=""
        id="discoveryUrl"
        name="discoveryUrl"
        placeholder="https://provider.example.com/.well-known/openid-configuration"
        type="text"
        bind:value={values.discoveryUrl}
      />
      {#if values.templateHint}
        <p class="text-text-subtle mt-1.5 text-xs">{values.templateHint}</p>
      {/if}
    </div>
    <div class="sm:col-span-2">
      <label class={label} for="scopes">Scopes (comma-separated)</label>
      <Input
        class=""
        id="scopes"
        name="scopes"
        placeholder="openid, profile, email"
        type="text"
        bind:value={values.scopes}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        Include the scope that carries group or role claims (often
        <span class="">groups</span>) if you want to restrict an app by
        group.
      </p>
    </div>
    <div>
      <label class={label} for="tokenAuthMethod">Client authentication</label>
      <Select.Root
        name="tokenAuthMethod"
        type="single"
        bind:value={values.tokenAuthMethod}
      >
        <Select.Trigger class="w-full" id="tokenAuthMethod">
          {TOKEN_AUTH_LABELS[values.tokenAuthMethod] ?? values.tokenAuthMethod}
        </Select.Trigger>
        <Select.Content>
          {#each Object.entries(TOKEN_AUTH_LABELS) as [value, text] (value)}
            <Select.Item label={text} {value} />
          {/each}
        </Select.Content>
      </Select.Root>
      <p class="text-text-subtle mt-1.5 text-xs">
        Automatic reads the provider's discovery document and prefers the HTTP
        Basic header when offered, which is what OpenID Connect defaults to.
        Override only if sign-in fails with
        <span class="">invalid_client</span>
        while the credentials are right.
      </p>
    </div>
    <div class="flex flex-col justify-end gap-3">
      <CheckBox
        helperText="Offer this provider on the sign-in page and to protected apps"
        id="enabled"
        label="Enabled"
        name="enabled"
        bind:checked={values.enabled}
      />
      <CheckBox
        helperText="Use PKCE for the OAuth code exchange"
        id="pkce"
        label="PKCE"
        name="pkce"
        bind:checked={values.pkce}
      />
    </div>
  </div>

  <CheckBox
    helperText="Also end the session at the provider when signing out of Homerun, sending you to its logout page. Off means signing out here only signs you out here."
    id="signOutOfProvider"
    label="Sign out of the provider too"
    name="signOutOfProvider"
    bind:checked={values.signOutOfProvider}
  />

  {#if callbackBase && values.name}
    <p class="text-text-subtle text-xs">
      Redirect URI to register with your provider:
      <span class="text-accent">
        {callbackBase}/api/v1/auth/callback/{values.name}
      </span>
    </p>
  {/if}
</div>
