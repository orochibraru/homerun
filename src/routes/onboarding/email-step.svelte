<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import {
		errorClass,
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
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
  description="Optional : used for verification links and invitations."
  {hidden}
  title="Email"
>
  <CheckBox
    helperText="Send email through this SMTP server"
    id="smtpEnabled"
    label="Enabled"
    name="smtpEnabled"
    bind:checked={wizard.smtpEnabled}
  />
  {#if wizard.smtpEnabled}
    <div class="grid gap-5 sm:grid-cols-2">
      <div>
        <label class={label} for="smtpHost">Host</label>
        <input
          class={input}
          id="smtpHost"
          name="smtpHost"
          type="text"
          bind:value={wizard.smtpHost}
        >
        {#if showError("smtpHost")}
          <p class={errorClass}>{showError("smtpHost")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="smtpPort">Port</label>
        <input
          class={input}
          id="smtpPort"
          name="smtpPort"
          type="text"
          bind:value={wizard.smtpPort}
        >
        {#if showError("smtpPort")}
          <p class={errorClass}>{showError("smtpPort")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="smtpUser">Username</label>
        <input
          class={input}
          id="smtpUser"
          name="smtpUser"
          type="text"
          bind:value={wizard.smtpUser}
        >
        {#if showError("smtpUser")}
          <p class={errorClass}>{showError("smtpUser")}</p>
        {/if}
      </div>
      <div>
        <label class={label} for="smtpPassword">Password</label>
        <input
          class={input}
          id="smtpPassword"
          name="smtpPassword"
          placeholder={wizard.settings?.smtpPasswordEnc
          ? "Leave blank to keep current"
          : "Password"}
          type="password"
          bind:value={wizard.smtpPassword}
        >
      </div>
      <div>
        <label class={label} for="smtpFrom">From address</label>
        <input
          class={input}
          id="smtpFrom"
          name="smtpFrom"
          type="text"
          bind:value={wizard.smtpFrom}
        >
        {#if showError("smtpFrom")}
          <p class={errorClass}>{showError("smtpFrom")}</p>
        {/if}
      </div>
      <div class="sm:col-span-2">
        <CheckBox
          helperText="Use TLS when connecting to the SMTP server"
          id="smtpSecure"
          label="Secure (TLS)"
          name="smtpSecure"
          bind:checked={wizard.smtpSecure}
        />
      </div>
    </div>
  {:else}
    <p class="text-xs text-text-subtle">
      Skippable : email verification just won't send until this is
      configured, here or later on Settings.
    </p>
  {/if}
</StepPanel>
