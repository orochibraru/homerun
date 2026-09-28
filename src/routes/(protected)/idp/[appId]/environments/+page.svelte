<script lang="ts">
	import { Plus } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import CopyBox from "$lib/components/copy-box.svelte";
	import OauthEnvironmentCard from "$lib/components/oauth-environment-card.svelte";
	import OauthEnvironmentFields, {
		type OauthEnvironmentFieldValues,
	} from "$lib/components/oauth-environment-fields.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	let adding = $state(false);
	const draft = $state<OauthEnvironmentFieldValues>({
		allowedOrigins: [""],
		allowLocalhost: true,
		name: "development",
		redirectUris: [""],
	});

	const newSecret = $derived(form && "secret" in form ? form.secret : null);
</script>

<div class="space-y-6">
  {#if newSecret}
    <section class="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-5">
      <p class="text-text text-sm font-medium">
        New client secret for {newSecret.environment}
      </p>
      <p class="text-text-muted mt-0.5 mb-3 text-xs">
        Shown once: paste it into {data.app.name}'s {newSecret.environment}
        configuration now, Homerun only keeps a hash.
      </p>
      <CopyBox label="client secret" value={newSecret.value} />
    </section>
  {/if}

  {#each data.environments as environment (environment.id)}
    <OauthEnvironmentCard
      canDelete={data.environments.length > 1}
      confidential={data.app.confidential}
      {environment}
      secrets={data.secrets.filter((secret) => secret.environmentId === environment.id)}
    />
  {/each}

  {#if adding}
    <section class="panel rounded-md">
      <div class="panel-head">
        <h2 class="text-text text-sm font-semibold">New environment</h2>
      </div>
      <form
        action="?/createEnvironment"
        class="space-y-5 p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't add the environment.",
          loading: "Adding the environment",
          onSuccess: () => {
            adding = false;
          },
          success: (result) =>
            result && "secret" in result
              ? "Environment added. Copy its first secret from the top of the page."
              : "Environment added.",
        })}
      >
        <OauthEnvironmentFields idPrefix="new" values={draft} />
        <div class="flex justify-end gap-2">
          <Button
            onclick={() => {
              adding = false;
            }}
            type="button"
            variant="ghost"
          >
            Cancel
          </Button>
          <Button type="submit">Add environment</Button>
        </div>
      </form>
    </section>
  {:else}
    <Button
      onclick={() => {
        adding = true;
      }}
      variant="outline"
    >
      <Plus class="size-4" />
      Add environment
    </Button>
  {/if}
</div>
