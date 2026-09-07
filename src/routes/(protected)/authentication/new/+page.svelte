<script lang="ts">
	import { ArrowLeft, Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { OAUTH_PRESETS, type OauthPreset } from "$lib/auth-providers";
	import { labelClass as label } from "$lib/components/form-styles";
	import OauthProviderFields, {
		type ProviderFieldValues,
	} from "$lib/components/oauth-provider-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	let submitting = $state(false);
	const values = $state<ProviderFieldValues>({
		clientId: "",
		discoveryUrl: "",
		enabled: true,
		hasSecret: false,
		label: "",
		name: "",
		pkce: true,
		scopes: "openid, profile, email",
		signOutOfProvider: false,
		templateHint: "",
		tokenAuthMethod: "auto",
	});

	onMount(() => title.set("Add a provider"));

	function applyPreset(preset: OauthPreset) {
		values.name = preset.id;
		values.label = preset.label;
		values.discoveryUrl = preset.template;
		values.scopes = preset.scopes.join(", ");
		values.pkce = preset.pkce;
		values.templateHint = preset.templateHint;
	}
</script>

<div class="space-y-6 p-6 md:p-8">
  <div>
    <Button href={resolve("/authentication")} size="sm" variant="ghost">
      <ArrowLeft class="size-4" />
      Authentication
    </Button>
    <h1 class="text-text mt-2 text-xl font-semibold">Add a provider</h1>
    <p class="text-text-muted mt-1 text-sm">
      Any OpenID Connect provider. Register an OAuth app on its side first, then
      paste the client id and secret here.
    </p>
  </div>

  <section class="glass rounded-2xl">
    <div class="border-border border-b px-5 py-4">
      <p class={label}>Start from a preset</p>
      <div class="flex flex-wrap gap-2">
        {#each OAUTH_PRESETS as preset (preset.id)}
          <Button
            onclick={() => applyPreset(preset)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Plus class="size-3.5" />
            {preset.label}
          </Button>
        {/each}
      </div>
      <p class="text-text-subtle mt-2 text-xs">
        A preset fills in the discovery URL shape, scopes and PKCE default for
        that product. Replace the
        <span class="font-mono">{"{placeholders}"}</span>
        with your own values.
      </p>
    </div>

    <form
      action="?/create"
      class="space-y-5 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't add the provider.",
        loading: "Adding the provider",
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Provider added.",
      })}
    >
      {#if form?.error}
        <p class="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
          {form.error}
        </p>
      {/if}

      <OauthProviderFields callbackBase={data.callbackBase} {values} />

      <div class="flex justify-end gap-2">
        <Button href={resolve("/authentication")} type="button" variant="ghost">
          Cancel
        </Button>
        <Button disabled={submitting} type="submit">Add provider</Button>
      </div>
    </form>
  </section>
</div>
