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
  description="The domain this instance and everything it deploys lives under."
  {hidden}
  title="Core"
>
  <div>
    <label class={label} for="baseDomain">Base domain</label>
    <input
      class={input}
      id="baseDomain"
      name="baseDomain"
      placeholder="example.com"
      type="text"
      bind:value={wizard.baseDomain}
    >
    <p class="mt-1.5 text-xs text-text-subtle">
      Deployed services are routed under &lt;slug&gt;.&lt;this&gt;.
    </p>
    {#if showError("baseDomain")}
      <p class={errorClass}>{showError("baseDomain")}</p>
    {/if}
  </div>
  <CheckBox
    helperText={`Origin: ${wizard.originPreview}`}
    id="useHttps"
    label="Use HTTPS"
    name="useHttps"
    bind:checked={wizard.useHttps}
  />
  <CheckBox
    helperText="Widens the session cookie to every subdomain of the base domain"
    id="authCrossSubdomainCookies"
    label="Cross-subdomain cookies"
    name="authCrossSubdomainCookies"
    bind:checked={wizard.authCrossSubdomainCookies}
  />
</StepPanel>
