<script lang="ts">
	import { ArrowLeft } from "@lucide/svelte";
	import IacApiKeyPanel from "#lib/components/iac-api-key-panel.svelte";
	import { resolve } from "$app/paths";

	const { data, form } = $props();
</script>

<div class="space-y-5">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm"
    href={resolve("/(protected)/iac/[projectId]/credentials", {
      projectId: data.project.id,
    })}
  >
    <ArrowLeft class="size-4" />
    All credentials
  </a>

  <IacApiKeyPanel
    createdKey={form?.apiKey ?? null}
    defaultName={data.project.name}
    tool={data.project.tool}
  />
</div>
