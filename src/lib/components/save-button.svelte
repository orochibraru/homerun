<script lang="ts">
	import { Check } from "@lucide/svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import Spinner from "#lib/components/ui/spinner/spinner.svelte";

	interface Props {
		disabled?: boolean;
		form: string;
		label?: string;
		pending?: boolean;
	}

	const {
		disabled = false,
		form,
		label = "Save",
		pending = false,
	}: Props = $props();
</script>

<Button disabled={disabled || pending} {form} size="sm" type="submit">
  {#if pending}
    <Spinner />
  {:else}
    <Check class="size-4" />
  {/if}
  {label}
</Button>
