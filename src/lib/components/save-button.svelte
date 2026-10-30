<script lang="ts">
	import { page } from "$app/state";
	import { Check } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { Spinner } from "@orochibraru/ui/spinner";
	import { onMount } from "svelte";

	interface Props {
		disabled?: boolean;
		form: string;
		label?: string;
		pending?: boolean;
		/** Keeps the button enabled with nothing changed, for a form whose save does something even when unchanged. */
		saveUnchanged?: boolean;
	}

	const {
		disabled = false,
		form,
		label = "Save",
		pending = false,
		saveUnchanged = false,
	}: Props = $props();

	const CHECK_EVERY_MS = 400;

	let baseline = $state<string | null>(null);
	let current = $state<string | null>(null);
	let previousBaseline: string | null = null;

	const dirty = $derived(baseline === null || current !== baseline);

	/** The form's values as one comparable string, files by name and size. */
	function snapshot(): string | null {
		const element = document.getElementById(form);
		if (!(element instanceof HTMLFormElement)) {
			return null;
		}
		return JSON.stringify(
			[...new FormData(element).entries()].map((entry: unknown[]) =>
				entry.map((part) =>
					part instanceof File ? `${part.name}:${part.size}` : String(part),
				),
			),
		);
	}

	onMount(() => {
		baseline = snapshot();
		current = baseline;
		const check = () => {
			current = snapshot();
		};
		const checkAfterClick = () => {
			requestAnimationFrame(check);
		};
		const onSubmit = (event: Event) => {
			if ((event.target as HTMLElement | null)?.id === form) {
				previousBaseline = baseline;
				baseline = snapshot();
			}
		};
		document.addEventListener("click", checkAfterClick, true);
		document.addEventListener("input", check, true);
		document.addEventListener("change", check, true);
		document.addEventListener("submit", onSubmit, true);
		const timer = setInterval(check, CHECK_EVERY_MS);
		return () => {
			document.removeEventListener("click", checkAfterClick, true);
			document.removeEventListener("input", check, true);
			document.removeEventListener("change", check, true);
			document.removeEventListener("submit", onSubmit, true);
			clearInterval(timer);
		};
	});

	$effect(() => {
		const result = page.form as { error?: unknown; errors?: unknown } | null;
		if (previousBaseline !== null && (result?.error || result?.errors)) {
			baseline = previousBaseline;
			previousBaseline = null;
		}
	});
</script>

<Button
	data-dirty={dirty || undefined}
	data-slot="save-button"
	disabled={disabled || pending || (!saveUnchanged && !dirty)}
	{form}
	size="sm"
	type="submit"
>
	{#if pending}
		<Spinner />
	{:else}
		<Check class="size-4" />
	{/if}
	{label}
</Button>
