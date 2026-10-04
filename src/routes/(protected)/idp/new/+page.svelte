<script lang="ts">
	import { ArrowRight } from "@lucide/svelte";
	import { onMount } from "svelte";
	import Alert from "#lib/components/alert.svelte";
	import OauthAppCredentials from "#lib/components/oauth-app-credentials.svelte";
	import OauthAppFields, {
		type OauthAppFieldValues,
	} from "#lib/components/oauth-app-fields.svelte";
	import OauthEnvironmentFields, {
		type OauthEnvironmentFieldValues,
	} from "#lib/components/oauth-environment-fields.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { CLAUDE_MCP_CALLBACK } from "#lib/oidc-provider.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	const { data, form } = $props();

	let submitting = $state(false);
	const values = $state<OauthAppFieldValues>({
		confidential: true,
		enableEndSession: true,
		name: "",
		requirePkce: false,
		skipConsent: true,
		tokenAuthMethod: "client_secret_basic",
	});
	const environment = $state<OauthEnvironmentFieldValues>({
		allowedOrigins: [""],
		allowLocalhost: false,
		name: "production",
		redirectUris: [""],
	});

	onMount(() => title.set("Register an app"));

	const isClaude = $derived(
		environment.redirectUris.includes(CLAUDE_MCP_CALLBACK),
	);

	function useClaudePreset() {
		values.confidential = true;
		values.enableEndSession = false;
		values.name = "Claude";
		environment.redirectUris = [CLAUDE_MCP_CALLBACK];
		values.requirePkce = true;
		values.tokenAuthMethod = "client_secret_post";
		values.skipConsent = false;
	}
</script>

<div class="space-y-6 p-5 md:p-6">
  <div>
    <h1 class="text-text text-xl font-semibold">
      {form?.created ? `${form.created.name} is registered` : "Register an app"}
    </h1>
    <p class="text-text-muted mt-1 text-sm">
      {#if form?.created}
        Paste these into the app's OpenID Connect settings. Most apps only need
        the discovery URL, the client ID and the secret.
      {:else}
        Lets an app use "Sign in with Homerun", with the same accounts,
        passkeys and two-factor rules as the dashboard.
      {/if}
    </p>
  </div>

  {#if !data.issuer}
    <Alert variant="warning">
      Set the Dashboard URL under Settings → General first. Homerun signs tokens
      as that address, so apps can't use it as a provider until it's set.
    </Alert>
  {:else if form?.created}
    <section class="panel space-y-5 rounded-md p-5">
      {#if isClaude && data.mcpUrl}
        <p class="text-text-muted text-sm">
          In Claude, open Settings → Connectors → Add custom connector, paste
          <code class="text-text">{data.mcpUrl}</code> as the URL, and this
          client ID and secret under Advanced settings.
        </p>
      {/if}
      <OauthAppCredentials
        clientId={form.created.clientId}
        clientSecret={form.created.clientSecret}
        endpointBase={data.endpointBase ?? data.issuer}
        issuer={data.issuer}
      />

      <div class="flex justify-end"><Button href={resolve('idp')}>Done <ArrowRight class="size-4" /></Button></div>
    </section>
  {:else}
    <section class="panel rounded-md">
      <form
        action="?/create"
        class="space-y-5 p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't register the app.",
          loading: "Registering the app",
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "App registered.",
        })}
      >
        {#if form?.error}
          <p class="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
            {form.error}
          </p>
        {/if}

        {#if data.mcpUrl}
          <div class="border-border bg-surface-2 flex flex-wrap items-center justify-between gap-3 rounded-md border p-3">
            <p class="text-text-muted text-xs">
              Connecting Claude to Homerun's MCP server? Start from the Claude
              connector settings.
            </p>
            <Button onclick={useClaudePreset} size="sm" type="button" variant="outline">
              Claude connector
            </Button>
          </div>
        {/if}

        <OauthAppFields values={values} />

        <div class="border-border border-t pt-5">
          <h2 class="text-text text-sm font-semibold">First environment</h2>
          <p class="text-text-muted mt-0.5 mb-4 text-xs">
            Add staging or development environments, with their own callbacks
            and secrets, from the app's Environments tab afterwards.
          </p>
          <OauthEnvironmentFields values={environment} />
        </div>

        <div class="flex justify-end gap-2">
          <Button
            href={resolve('idp')}
            type="button"
            variant="ghost"
          >Cancel</Button>

          <Button disabled={submitting} type="submit">Register app</Button>
        </div>
      </form>
    </section>
  {/if}
</div>
