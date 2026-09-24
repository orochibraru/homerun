<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import {
		errorClass,
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import StepPanel from "./step-panel.svelte";
	import type { OnboardingWizard } from "./wizard-state.svelte";

	interface Props {
		hidden: boolean;
		showError: (field: string) => string | undefined;
		wizard: OnboardingWizard;
	}

	const { hidden, showError, wizard }: Props = $props();
</script>

<StepPanel
  description="Optional : create a DNS record or tunnel route for every service you deploy."
  {hidden}
  title="DNS"
>
  <CheckBox
    helperText="Upsert a CNAME in a Cloudflare zone for every deployed hostname"
    id="cloudflareEnabled"
    label="Cloudflare"
    name="cloudflareEnabled"
    bind:checked={wizard.cloudflareEnabled}
  />
  {#if wizard.cloudflareEnabled}
    <div class="grid gap-5 sm:grid-cols-2">
      <div>
        <label class={label} for="cloudflareZoneId">Zone ID</label>
        <input
          class={input}
          id="cloudflareZoneId"
          name="cloudflareZoneId"
          type="text"
          bind:value={wizard.cloudflareZoneId}
        >
        {#if showError("cloudflareZoneId")}
          <p class={errorClass}>{showError("cloudflareZoneId")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="cloudflareApiToken">API token</label>
        <input
          class={input}
          id="cloudflareApiToken"
          name="cloudflareApiToken"
          placeholder={wizard.settings?.cloudflareApiTokenEnc
          ? "Leave blank to keep current"
          : "Zone:DNS:Edit scope"}
          type="password"
          bind:value={wizard.cloudflareApiToken}
        >
        {#if showError("cloudflareApiToken")}
          <p class={errorClass}>{showError("cloudflareApiToken")}</p>
        {/if}
      </div>
    </div>
    <div class="flex justify-end">
      <Button formaction="?/testCloudflare" type="submit" variant="outline">
        Test Cloudflare
      </Button>
    </div>
  {/if}

  <CheckBox
    helperText="Create a Pangolin Resource and Target through a tunnel site for every deployed hostname"
    id="pangolinEnabled"
    label="Pangolin"
    name="pangolinEnabled"
    bind:checked={wizard.pangolinEnabled}
  />
  {#if wizard.pangolinEnabled}
    <div class="grid gap-5 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label class={label} for="pangolinApiBaseUrl">API base URL</label>
        <input
          class={input}
          id="pangolinApiBaseUrl"
          name="pangolinApiBaseUrl"
          placeholder="https://api.pangolin.example.com/v1"
          type="text"
          bind:value={wizard.pangolinApiBaseUrl}
        >
        <p class="mt-1.5 text-xs text-text-subtle">
          The Integration API (port 3003 by default, path ending in
          <code>/v1</code>), not the Pangolin dashboard.
        </p>
        {#if showError("pangolinApiBaseUrl")}
          <p class={errorClass}>{showError("pangolinApiBaseUrl")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="pangolinOrgId">Org ID</label>
        <input
          class={input}
          id="pangolinOrgId"
          name="pangolinOrgId"
          type="text"
          bind:value={wizard.pangolinOrgId}
        >
        {#if showError("pangolinOrgId")}
          <p class={errorClass}>{showError("pangolinOrgId")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="pangolinMainSiteName">Site name</label>
        <input
          class={input}
          id="pangolinMainSiteName"
          name="pangolinMainSiteName"
          type="text"
          bind:value={wizard.pangolinMainSiteName}
        >
        {#if showError("pangolinMainSiteName")}
          <p class={errorClass}>{showError("pangolinMainSiteName")}</p>
        {/if}
      </div>
      <div class="sm:col-span-2">
        <label class={label} for="pangolinApiToken">API token</label>
        <input
          class={input}
          id="pangolinApiToken"
          name="pangolinApiToken"
          placeholder={wizard.settings?.pangolinApiTokenEnc
          ? "Leave blank to keep current"
          : ""}
          type="password"
          bind:value={wizard.pangolinApiToken}
        >
        {#if showError("pangolinApiToken")}
          <p class={errorClass}>{showError("pangolinApiToken")}</p>
        {/if}
      </div>
    </div>
    <div class="grid gap-5 sm:grid-cols-2">
      <div class="sm:col-span-2">
        <label class={label} for="pangolinNewtEndpoint">Newt endpoint</label>
        <input
          class={input}
          id="pangolinNewtEndpoint"
          name="pangolinNewtEndpoint"
          placeholder="https://pangolin.example.com"
          type="text"
          bind:value={wizard.pangolinNewtEndpoint}
        >
        <p class="mt-1.5 text-xs text-text-subtle">
          Optional. With the endpoint, ID and secret from the site's
          page in Pangolin, Homerun runs its own Newt tunnel client on
          this host, kept out of your services list. Leave blank when
          Newt runs somewhere else.
        </p>
        {#if showError("pangolinNewtEndpoint")}
          <p class={errorClass}>{showError("pangolinNewtEndpoint")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="pangolinNewtId">Newt ID</label>
        <input
          class={input}
          id="pangolinNewtId"
          name="pangolinNewtId"
          type="text"
          bind:value={wizard.pangolinNewtId}
        >
        {#if showError("pangolinNewtId")}
          <p class={errorClass}>{showError("pangolinNewtId")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="pangolinNewtSecret">Newt secret</label>
        <input
          class={input}
          id="pangolinNewtSecret"
          name="pangolinNewtSecret"
          placeholder={wizard.settings?.pangolinNewtSecretEnc
          ? "Leave blank to keep current"
          : ""}
          type="password"
          bind:value={wizard.pangolinNewtSecret}
        >
        {#if showError("pangolinNewtSecret")}
          <p class={errorClass}>{showError("pangolinNewtSecret")}</p>
        {/if}
      </div>
    </div>
    <p class="text-xs text-text-subtle">
      Target host, target port and Pangolin sign-in live on Settings →
      Networking, where they default to detected values.
    </p>
    <div class="flex justify-end">
      <Button formaction="?/testPangolin" type="submit" variant="outline">
        Test Pangolin
      </Button>
    </div>
  {/if}

  {#if !(wizard.cloudflareEnabled || wizard.pangolinEnabled)}
    <p class="text-xs text-text-subtle">
      Skippable : add DNS records by hand, or turn either integration on
      later from Settings → Networking.
    </p>
  {/if}
</StepPanel>
