<script lang="ts">
	import MigratePanel from "$lib/components/migrate-panel.svelte";

	const { form } = $props();
</script>

<MigratePanel
  {form}
  label="Coolify"
  tokenHelp="Coolify → Keys & Tokens → API tokens, with read and read:sensitive (without it, env values and database passwords come back hidden). Never stored."
  urlPlaceholder="https://coolify.example.com"
/>
