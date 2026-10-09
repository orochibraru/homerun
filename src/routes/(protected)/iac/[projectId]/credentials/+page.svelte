<script lang="ts">
	import { KeyRound, Plus } from "@lucide/svelte";
	import ApiKeyList from "#lib/components/api-key-list.svelte";
	import BucketAccessKeys from "#lib/components/bucket-access-keys.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { usesHttpBackend } from "#lib/iac/tools.js";
	import { resolve } from "$app/paths";

	const { data, form } = $props();
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description={usesHttpBackend(data.project.tool)
        ? "Every API key on your account. The provider reads one as HOMERUN_API_KEY and the state backend as TF_HTTP_PASSWORD."
        : "Every API key on your account. The provider reads one from the homerun:apiKey config."}
      icon={KeyRound}
      title="API keys"
    >
      {#snippet trailing()}
        <Button
          href={resolve("/(protected)/iac/[projectId]/credentials/new", {
            projectId: data.project.id,
          })}
          size="sm"
        >
          <Plus class="size-4" />
          New API key
        </Button>
      {/snippet}
    </PanelHeader>
    <div class="p-5">
      <ApiKeyList emptySubtitle="Create one for this project." keys={data.apiKeys} />
    </div>
  </section>

  {#if !usesHttpBackend(data.project.tool) && data.store && !data.bucket.problem}
    <BucketAccessKeys
      createdKey={form?.createdKey ?? null}
      endpoint={data.store.endpoint}
      keys={data.bucket.keys}
      region={data.store.region}
    />
  {/if}

  <p class="text-text-muted text-xs">
    For a key narrowed to a few permissions, use
    <a class="text-accent hover:underline" href={resolve("/(protected)/profile/api-keys/new")}>Profile → API Keys</a>.
  </p>
</div>
