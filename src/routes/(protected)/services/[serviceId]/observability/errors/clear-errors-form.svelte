<script lang="ts">
	import { enhance } from "$app/forms";
	import { Eraser } from "@lucide/svelte";

	import { Button } from "#lib/components/ui/button/index.js";
	import { enhanceToast } from "#lib/toast.js";

	let clearing = $state(false);
</script>

<form
	action="?/clearErrors"
	class="mt-2 flex justify-end"
	method="POST"
	use:enhance={enhanceToast({
		error: "Couldn't clear the errors.",
		loading: "Clearing errors",
		onSettled: () => {
			clearing = false;
		},
		onStart: () => {
			clearing = true;
		},
		success: "Errors cleared.",
	})}
>
	<Button disabled={clearing} size="sm" type="submit" variant="ghost">
		<Eraser class="size-3.5" />
		Clear errors
	</Button>
</form>
