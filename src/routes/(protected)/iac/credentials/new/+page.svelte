<script lang="ts">
	import { ArrowLeft } from "@lucide/svelte";
	import IacApiKeyPanel from "#lib/components/iac-api-key-panel.svelte";
	import { resolve } from "$app/paths";

	const { form } = $props();
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/iac/credentials")}
  >
    <ArrowLeft class="size-4" />
    All credentials
  </a>

  <IacApiKeyPanel createdKey={form?.apiKey ?? null} />
</div>
