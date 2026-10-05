<script lang="ts">
	import { HOMERUN_URL } from "#lib/error-pages.js";

	const { class: className = "" }: { class?: string } = $props();
</script>

<p class="text-text-subtle text-center text-xs {className}">
  Powered by
  <a
    class="hover:text-text underline underline-offset-2"
    href={HOMERUN_URL}
    rel="noopener noreferrer"
    target="_blank">Homerun</a
  >
</p>
