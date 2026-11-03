<script lang="ts">
	import { resolve } from "$app/paths";
	import { onMount } from "svelte";

	import { title } from "#lib/store/title.js";

	import DomainsSection from "./domains-section.svelte";
	import SslSection from "./ssl-section.svelte";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Domains`));

	let submitting = $state(false);
</script>

<div class="space-y-6">
	<DomainsSection
		baseDomain={data.baseDomain}
		networkHref={resolve(
			"/(protected)/services/[serviceId]/networking/network",
			{
				serviceId: svc.id,
			},
		)}
		serviceDomain={data.serviceDomain}
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
</div>
