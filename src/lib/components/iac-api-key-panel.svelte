<script lang="ts">
	import { KeyRound } from "@lucide/svelte";
	import Alert from "#lib/components/alert.svelte";
	import CopyBox from "#lib/components/copy-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import * as Select from "#lib/components/ui/select/index.js";
	import {
		API_KEY_EXPIRY_OPTIONS,
		type ApiKeyExpiry,
		DEFAULT_API_KEY_EXPIRY,
	} from "#lib/permissions.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		createdKey: string | null;
	}

	const { createdKey }: Props = $props();

	let name = $state("Terraform");
	let expiry = $state<ApiKeyExpiry>(DEFAULT_API_KEY_EXPIRY);
	let creating = $state(false);
	const expiryLabel = $derived(
		API_KEY_EXPIRY_OPTIONS.find((option) => option.value === expiry)?.label ??
			"",
	);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="One key for both the Terraform provider and the state backend, with the permissions your account has today."
    icon={KeyRound}
    title="API key"
  >
    {#snippet trailing()}
      <SaveButton form="iac-api-key" label="Create key" pending={creating} />
    {/snippet}
  </PanelHeader>
  <div class="space-y-4 px-5 py-4">
    {#if createdKey}
      <div class="border-accent/40 rounded-lg border p-4">
        <p class="text-text text-sm font-medium">Key created</p>
        <p class="text-text-muted mt-1 mb-3 text-sm">
          This is the only time it's shown. Export both before
          <code>terraform init</code>.
        </p>
        <CopyBox
          value={`export HOMERUN_API_KEY=${createdKey}\nexport TF_HTTP_PASSWORD=${createdKey}`}
        />
      </div>
    {/if}
    <form
      id="iac-api-key"
      class="grid gap-4 sm:grid-cols-2"
      action="?/createApiKey"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't create the key.",
        loading: "Creating the key",
        onSettled: () => {
          creating = false;
        },
        onStart: () => {
          creating = true;
        },
        success: "Key created.",
      })}
    >
      <div>
        <label class={labelClass} for="iac-key-name">Name</label>
        <input
          id="iac-key-name"
          class={inputClass}
          autocomplete="off"
          name="name"
          required
          bind:value={name}
        >
      </div>
      <div>
        <label class={labelClass} for="iac-key-expiry">Expires</label>
        <Select.Root name="expiry" type="single" bind:value={expiry}>
          <Select.Trigger id="iac-key-expiry" class="w-full">{expiryLabel}</Select.Trigger>
          <Select.Content>
            {#each API_KEY_EXPIRY_OPTIONS as option (option.value)}
              <Select.Item label={option.label} value={option.value} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
    </form>
    {#if expiry === "never"}
      <Alert variant="warning">
        A key that never expires keeps working until you revoke it. Set an
        expiry unless something can't rotate it.
      </Alert>
    {/if}
  </div>
</section>
