<script lang="ts">
	import CopyBox from "#lib/components/copy-box.svelte";

	interface Props {
		builtin: boolean;
		endpoint: string;
		region: string;
	}

	const { builtin, endpoint, region }: Props = $props();
</script>

<div class="grid gap-4 px-5 py-4 text-sm md:grid-cols-3">
  <div class="md:col-span-2">
    <p class="text-text-subtle mb-1.5 text-xs">Endpoint</p>
    <CopyBox label="endpoint" value={endpoint} />
    {#if builtin && !endpoint.startsWith("https://")}
      <p class="text-text-subtle mt-1.5 text-xs">
        Reachable from containers on Homerun's network. Publish the
        built-in store under Built-in to reach it from elsewhere.
      </p>
    {/if}
  </div>
  <div>
    <p class="text-text-subtle mb-1.5 text-xs">Region</p>
    <CopyBox label="region" value={region} />
    <p class="text-text-subtle mt-1.5 text-xs">Use path-style addressing.</p>
  </div>
</div>
