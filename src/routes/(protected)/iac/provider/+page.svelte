<script lang="ts">
	import { Package } from "@lucide/svelte";
	import CodeBlock from "#lib/components/code-block.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { PROVIDER_SOURCE } from "#lib/iac/generate.js";

	const { data } = $props();
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description={`Source address ${PROVIDER_SOURCE}. Resources cover stacks, services and every setting they have, environments, dependencies, volumes and mounts, cron jobs, redirects, notification channels, backup destinations, status pages, DNS connections, git providers, build cache registries, object stores and buckets.`}
      icon={Package}
      title="Terraform provider"
    />
    <div class="divide-border divide-y">
      {#each data.snippets as snippet (snippet.id)}
        <div class="space-y-2 px-5 py-4">
          <h3 class="text-text text-sm font-medium">{snippet.title}</h3>
          <p class="text-text-muted text-xs">{snippet.description}</p>
          <CodeBlock code={snippet.code} html={snippet.html} label={snippet.title} />
        </div>
      {/each}
    </div>
  </section>
</div>
