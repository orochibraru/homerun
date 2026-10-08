<script lang="ts">
	import { KeyRound, Plus } from "@lucide/svelte";
	import { onMount } from "svelte";
	import ApiKeyList from "#lib/components/api-key-list.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { title } from "#lib/store/title.js";
	import { resolve } from "$app/paths";

	const { data } = $props();

	onMount(() => title.set("API Keys"));
</script>

<section class="rounded-md panel">
  <div class="flex items-center gap-3 border-b border-border px-5 py-4">
    <div class="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
      <KeyRound class="size-4" />
    </div>
    <div class="min-w-0 flex-1">
      <h2 class="eyebrow">API Keys</h2>
      <p class="text-xs text-text-muted">
        API keys for the Homerun CLI or your own scripts. Same
        <code>x-api-key</code>
        auth the REST API accepts. A key can only do what you can, narrowed
        to the permissions you pick for it.
      </p>
    </div>
    <Button href={resolve("/(protected)/profile/api-keys/new")} size="sm">
      <Plus class="size-4" />
      New API key
    </Button>
  </div>
  <div class="p-5">
    <ApiKeyList
      emptySubtitle="Create one to authenticate the Homerun CLI or a script."
      keys={data.apiKeys}
    />
  </div>
</section>
