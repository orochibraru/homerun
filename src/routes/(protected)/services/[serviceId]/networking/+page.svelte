<script lang="ts">
	import { onMount } from "svelte";
	import { title } from "$lib/store/title";
	import DomainsSection from "./domains-section.svelte";
	import NetworkSection from "./network-section.svelte";
	import SslSection from "./ssl-section.svelte";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Networking`));

	let submitting = $state(false);
</script>

<div class="space-y-6">
  <DomainsSection
    baseDomain={data.baseDomain}
    stackSlug={data.stackSlug}
    {svc}
    bind:submitting
  />
  <SslSection
    baseDomain={data.baseDomain}
    behindPangolin={data.behindPangolin}
    certResolver={data.certResolver}
    {svc}
    bind:submitting
  />
  <NetworkSection
    baseDomain={data.baseDomain}
    errors={form?.errors as Record<string, string[]> | undefined}
    submittedValues={form?.portsValues as Record<string, string> | undefined}
    {svc}
  />
</div>
