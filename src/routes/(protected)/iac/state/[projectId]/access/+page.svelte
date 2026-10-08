<script lang="ts">
	import { Database } from "@lucide/svelte";
	import BucketAccessKeys from "#lib/components/bucket-access-keys.svelte";
	import BucketConnection from "#lib/components/bucket-connection.svelte";
	import CodeBlock from "#lib/components/code-block.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";

	const { data, form } = $props();
</script>

{#if data.store}
  <div class="space-y-5">
    <section class="panel rounded-md">
      <PanelHeader
        description="Terraform never needs these: it only talks to Homerun. Pulumi doesn't speak Terraform's backend protocol, so it reads and writes the bucket itself with an access key, and keeps its own history and locks there."
        icon={Database}
        title="Bucket and Pulumi"
      />
      <BucketConnection
        builtin={data.store.kind === "garage"}
        endpoint={data.store.endpoint}
        region={data.store.region}
      />
      {#if data.pulumi}
        <div class="border-border border-t px-5 py-4">
          <CodeBlock code={data.pulumi.code} html={data.pulumi.html} label="pulumi login" />
          <p class="text-text-muted mt-1.5 text-xs">
            With <code>AWS_ACCESS_KEY_ID</code> and
            <code>AWS_SECRET_ACCESS_KEY</code> from an access key below.
          </p>
        </div>
      {/if}
    </section>

    {#if !data.bucket.problem}
      <BucketAccessKeys
        createdKey={form?.createdKey ?? null}
        endpoint={data.store.endpoint}
        keys={data.bucket.keys}
        region={data.store.region}
      />
    {/if}
  </div>
{/if}
