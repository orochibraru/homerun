<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import { inputClass, labelClass } from "$lib/components/form-styles";

	export interface OauthAppFieldValues {
		confidential: boolean;
		enableEndSession: boolean;
		name: string;
		redirectUris: string;
		requirePkce: boolean;
		skipConsent: boolean;
	}

	const {
		typeLocked = false,
		values,
	}: {
		typeLocked?: boolean;
		values: OauthAppFieldValues;
	} = $props();
</script>

<div class="space-y-5">
  <div>
    <label class={labelClass} for="name">Name</label>
    <input
      class={inputClass}
      id="name"
      name="name"
      placeholder="Grafana"
      required
      bind:value={values.name}
    />
    <p class="text-text-subtle mt-1.5 text-xs">
      Shown on the consent screen and in this list.
    </p>
  </div>

  <div>
    <label class={labelClass} for="redirectUris">Redirect URIs</label>
    <textarea
      class="{inputClass} min-h-24 font-mono text-xs"
      id="redirectUris"
      name="redirectUris"
      placeholder="https://grafana.example.com/login/generic_oauth"
      required
      bind:value={values.redirectUris}
    ></textarea>
    <p class="text-text-subtle mt-1.5 text-xs">
      One per line, exactly as the app sends it, and https only. The app's own
      OIDC or OAuth settings page usually shows it as the callback or redirect
      URL.
    </p>
  </div>

  {#if !typeLocked}
    <fieldset class="space-y-2">
      <legend class={labelClass}>Client type</legend>
      <label class="flex items-start gap-3 rounded-md border p-3">
        <input
          checked={values.confidential}
          class="mt-0.5"
          name="clientType"
          onchange={() => {
            values.confidential = true;
          }}
          type="radio"
          value="confidential"
        />
        <span class="grid gap-1">
          <span class="text-sm font-medium">Confidential</span>
          <span class="text-text-muted text-xs">
            A server-side app that can keep a client secret: Grafana, Gitea,
            Outline, Immich and most self-hosted apps.
          </span>
        </span>
      </label>
      <label class="flex items-start gap-3 rounded-md border p-3">
        <input
          checked={!values.confidential}
          class="mt-0.5"
          name="clientType"
          onchange={() => {
            values.confidential = false;
          }}
          type="radio"
          value="public"
        />
        <span class="grid gap-1">
          <span class="text-sm font-medium">Public</span>
          <span class="text-text-muted text-xs">
            A browser or mobile app that can't hide a secret. Gets no secret and
            always has to use PKCE.
          </span>
        </span>
      </label>
    </fieldset>
  {/if}

  {#if values.confidential}
    <CheckBox
      helperText="Reject sign-ins that don't send a PKCE challenge. Leave off unless you know the app supports PKCE: many self-hosted apps don't."
      id="requirePkce"
      label="Require PKCE"
      name="requirePkce"
      bind:checked={values.requirePkce}
    />
  {/if}

  <CheckBox
    helperText="Trusted apps you host yourself don't need to ask each user to approve sharing their name and email."
    id="skipConsent"
    label="Skip the consent screen"
    name="skipConsent"
    bind:checked={values.skipConsent}
  />
  <CheckBox
    helperText="Let the app sign the user out of Homerun too, through the end-session endpoint."
    id="enableEndSession"
    label="Allow single sign-out"
    name="enableEndSession"
    bind:checked={values.enableEndSession}
  />
</div>
