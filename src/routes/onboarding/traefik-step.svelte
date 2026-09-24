<script lang="ts">
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
  description="The router that puts your services on the internet, with certificates."
  {hidden}
  title="Traefik"
>
  <div class="grid gap-5 sm:grid-cols-2">
    <div>
      <label class={label} for="traefikEntrypoint">Entrypoint</label>
      <input
        class={input}
        id="traefikEntrypoint"
        name="traefikEntrypoint"
        type="text"
        bind:value={wizard.traefikEntrypoint}
      >
      {#if showError("traefikEntrypoint")}
        <p class={errorClass}>{showError("traefikEntrypoint")}</p>
      {/if}
    </div>
    <div>
      <label class={label} for="traefikCertResolver"
      >Cert resolver</label>
      <input
        class={input}
        id="traefikCertResolver"
        name="traefikCertResolver"
        type="text"
        bind:value={wizard.traefikCertResolver}
      >
      {#if showError("traefikCertResolver")}
        <p class={errorClass}>{showError("traefikCertResolver")}</p>
      {/if}
    </div>
  </div>
  <div>
    <label class={label} for="traefikDynamicConfigDir"
    >Dynamic config directory (optional)</label>
    <input
      class="{input}"
      id="traefikDynamicConfigDir"
      name="traefikDynamicConfigDir"
      placeholder="unset : custom SSL is a no-op"
      type="text"
      bind:value={wizard.traefikDynamicConfigDir}
    >
  </div>
</StepPanel>
