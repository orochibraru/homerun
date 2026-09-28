<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import { inputClass, labelClass } from "$lib/components/form-styles";
	import UrlListInput from "$lib/components/url-list-input.svelte";
	import { callbackUrlProblem, originProblem } from "$lib/oidc-provider";

	export interface OauthEnvironmentFieldValues {
		allowedOrigins: string[];
		allowLocalhost: boolean;
		name: string;
		redirectUris: string[];
	}

	const {
		idPrefix = "env",
		values,
	}: {
		idPrefix?: string;
		values: OauthEnvironmentFieldValues;
	} = $props();

	/** What the app receives on a successful sign-in at this callback. */
	function callbackPreview(url: string): string {
		const separator = url.includes("?") ? "&" : "?";
		return `→ ${url}${separator}code=…&state=…`;
	}
</script>

<div class="space-y-5">
  <div>
    <label class={labelClass} for="{idPrefix}-name">Environment</label>
    <input
      class={inputClass}
      id="{idPrefix}-name"
      maxlength="32"
      name="environmentName"
      placeholder="production"
      required
      bind:value={values.name}
    >
    <p class="text-text-subtle mt-1.5 text-xs">
      Production, staging, development or anything else. Each environment has
      its own callback URLs, origins and secrets, and a secret only works with
      its own environment's callbacks.
    </p>
  </div>

  <CheckBox
    helperText="Accept http://localhost and 127.0.0.1 callbacks and origins, for running the app on your machine. Leave off for production: a localhost callback there lets anything running on a user's computer receive their sign-in."
    id="{idPrefix}-allowLocalhost"
    label="Allow localhost"
    name="allowLocalhost"
    bind:checked={values.allowLocalhost}
  />

  <div>
    <label class={labelClass} for="{idPrefix}-redirectUris">Callback URLs</label>
    <UrlListInput
      addLabel="Add callback URL"
      id="{idPrefix}-redirectUris"
      name="redirectUris"
      placeholder={values.allowLocalhost
        ? "http://localhost:3000/auth/callback"
        : "https://grafana.example.com/login/generic_oauth"}
      preview={callbackPreview}
      validate={(url) => callbackUrlProblem(url, values.allowLocalhost)}
      bind:values={values.redirectUris}
    />
    <p class="text-text-subtle mt-1.5 text-xs">
      Exactly as the app sends it; its OIDC or OAuth settings page usually
      shows it as the callback or redirect URL.
    </p>
  </div>

  <div>
    <label class={labelClass} for="{idPrefix}-allowedOrigins">Authorized origins</label>
    <UrlListInput
      addLabel="Add origin"
      id="{idPrefix}-allowedOrigins"
      name="allowedOrigins"
      placeholder="https://app.example.com"
      validate={(origin) => originProblem(origin, values.allowLocalhost)}
      bind:values={values.allowedOrigins}
    />
    <p class="text-text-subtle mt-1.5 text-xs">
      Only for apps that sign in from the browser (a SPA calling the token
      endpoint itself). A browser request from any other origin is refused.
      Server-side apps don't need any.
    </p>
  </div>
</div>
