<script lang="ts">
	import { ArrowRight } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import OauthAppCredentials from "$lib/components/oauth-app-credentials.svelte";
	import OauthAppFields, {
		type OauthAppFieldValues,
	} from "$lib/components/oauth-app-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	let submitting = $state(false);
	const values = $state<OauthAppFieldValues>({
		confidential: true,
		enableEndSession: true,
		name: "",
		redirectUris: "",
		requirePkce: false,
		skipConsent: true,
	});

	onMount(() => title.set("Register an app"));
</script>

<div class="space-y-6 p-6 md:p-8">
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
      <OauthAppCredentials
        clientId={form.created.clientId}
        clientSecret={form.created.clientSecret}
        issuer={data.issuer}
      />
      <div class="flex justify-end">
        <Button href={resolve("/authentication")}>
          Done
          <ArrowRight class="size-4" />
        </Button>
      </div>
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

        <OauthAppFields {values} />

        <div class="flex justify-end gap-2">
          <Button href={resolve("/authentication")} type="button" variant="ghost">
            Cancel
          </Button>
          <Button disabled={submitting} type="submit">Register app</Button>
        </div>
      </form>
    </section>
  {/if}
</div>
