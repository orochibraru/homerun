<script lang="ts">
	import { onMount } from "svelte";

	import { title } from "#lib/store/title.js";

	import AutoRedeploySection from "./auto-redeploy-section.svelte";
	import AutoRollbackSection from "./auto-rollback-section.svelte";
	import ImageScanSection from "./image-scan-section.svelte";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Automation`));
</script>

<div class="space-y-6">
	<AutoRollbackSection {svc} />
	<ImageScanSection {svc} />
	<AutoRedeploySection cronError={form?.cronError} {svc} />
</div>
