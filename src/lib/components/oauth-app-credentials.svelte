<script lang="ts">
	import CopyBox from "$lib/components/copy-box.svelte";
	import { labelClass } from "$lib/components/form-styles";

	const {
		clientId,
		clientSecret = null,
		endpointBase,
		issuer,
	}: {
		clientId: string;
		clientSecret?: string | null;
		endpointBase: string;
		issuer: string;
	} = $props();

	const endpoints = $derived([
		{ label: "Issuer", value: issuer },
		{
			label: "Discovery URL",
			value: `${issuer}/.well-known/openid-configuration`,
		},
		{
			label: "Authorization endpoint",
			value: `${endpointBase}/oauth2/authorize`,
		},
		{ label: "Token endpoint", value: `${endpointBase}/oauth2/token` },
		{ label: "Userinfo endpoint", value: `${endpointBase}/oauth2/userinfo` },
		{ label: "JWKS URI", value: `${endpointBase}/jwks` },
	]);
</script>

<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
  <div>
    <p class={labelClass}>Client ID</p>
    <CopyBox label="client ID" value={clientId} />
  </div>
  {#if clientSecret}
    <div>
      <p class={labelClass}>Client secret</p>
      <CopyBox label="client secret" value={clientSecret} />
      <p class="text-text-subtle mt-1.5 text-xs">
        Shown once. Copy it into the app now: Homerun only keeps a hash.
      </p>
    </div>
  {/if}
  {#each endpoints as endpoint (endpoint.label)}
    <div>
      <p class={labelClass}>{endpoint.label}</p>
      <CopyBox label={endpoint.label} truncate value={endpoint.value} />
    </div>
  {/each}
  <div>
    <p class={labelClass}>Scopes</p>
    <CopyBox label="scopes" value="openid profile email groups" />
  </div>
</div>
