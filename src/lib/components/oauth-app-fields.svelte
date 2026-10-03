<script lang="ts">
	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";

	export interface OauthAppFieldValues {
		confidential: boolean;
		enableEndSession: boolean;
		name: string;
		requirePkce: boolean;
		skipConsent: boolean;
		tokenAuthMethod: string;
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
    <fieldset class="space-y-2">
      <legend class={labelClass}>How the app sends its secret</legend>
      {#each [
        { hint: "In an Authorization: Basic header. What most OIDC libraries do by default.", label: "HTTP Basic (client_secret_basic)", value: "client_secret_basic" },
        { hint: "As client_id and client_secret fields in the request body. Pick this when the app's logs say it can't use client_secret_basic, or \"cannot use client_secret_post\" shows up here.", label: "Request body (client_secret_post)", value: "client_secret_post" },
      ] as option (option.value)}
        <label class="flex items-start gap-3 rounded-md border p-3">
          <input
            checked={values.tokenAuthMethod === option.value}
            class="mt-0.5"
            name="tokenAuthMethod"
            onchange={() => {
              values.tokenAuthMethod = option.value;
            }}
            type="radio"
            value={option.value}
          />
          <span class="grid gap-1">
            <span class="text-sm font-medium">{option.label}</span>
            <span class="text-text-muted text-xs">{option.hint}</span>
          </span>
        </label>
      {/each}
    </fieldset>

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
