<script lang="ts">
	import { KeyRound, Plus } from "@lucide/svelte";
	import ApiKeyList from "#lib/components/api-key-list.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { resolve } from "$app/paths";

	const { data } = $props();
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description="Every API key on your account. Terraform reads one as HOMERUN_API_KEY for the provider and TF_HTTP_PASSWORD for the state backend."
      icon={KeyRound}
      title="API keys"
    >
      {#snippet trailing()}
        <Button href={resolve("/(protected)/iac/credentials/new")} size="sm">
          <Plus class="size-4" />
          New Terraform key
        </Button>
      {/snippet}
    </PanelHeader>
    <div class="p-5">
      <ApiKeyList
        emptySubtitle="Create one for Terraform and its state backend."
        keys={data.apiKeys}
      />
    </div>
  </section>

  <p class="text-text-muted text-xs">
    For a key narrowed to a few permissions, use
    <a class="text-accent hover:underline" href={resolve("/(protected)/profile/api-keys/new")}>Profile → API Keys</a>.
    Pulumi's bucket keys live on each
    <a class="text-accent hover:underline" href={resolve("/(protected)/iac/state")}>state backend</a>.
  </p>
</div>
