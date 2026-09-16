<script lang="ts">
	import MigratePanel from "$lib/components/migrate-panel.svelte";

	const { form } = $props();
</script>

<MigratePanel
  {form}
  label="Dokploy"
  tokenHelp="Dokploy → Settings → Profile → API/CLI. Only read with, and never stored : it's sent along with each request on this page."
  urlPlaceholder="https://dokploy.example.com"
/>
