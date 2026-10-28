<script lang="ts">
	import { ScanSearch } from "@lucide/svelte";

	interface Props {
		show: boolean;
	}

	const { show }: Props = $props();
</script>

{#if show}
	<span
		class="text-accent ml-1.5 inline-flex items-center gap-0.5 text-[11px] font-normal"
		title="Filled in from what was detected : change it to keep your own value"
	>
		<ScanSearch class="size-3" />
		detected
	</span>
{/if}
