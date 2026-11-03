<script lang="ts">
	import { onMount } from "svelte";

	import { title } from "#lib/store/title.js";

	import CacheSection from "./cache-section.svelte";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Cache`));
</script>

<CacheSection available={data.httpCacheAvailable} {svc} />
