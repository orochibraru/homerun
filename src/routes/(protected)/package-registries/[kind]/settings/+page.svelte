<script lang="ts">
	import { enhance } from "$app/forms";
	import { Input } from "@orochibraru/ui/input";

	import CheckBox from "#lib/components/check-box.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { PACKAGE_REGISTRY_INFO } from "#lib/package-registries.js";

	const { data } = $props();

	const info = $derived(PACKAGE_REGISTRY_INFO[data.kind]);

	let enabled = $state(false);
	$effect(() => {
		enabled = data.status.enabled;
	});
	let publicHost = $state("");
	$effect(() => {
		publicHost = data.status.publicHost ?? "";
	});
	let saving = $state(false);
</script>

<section class="border-border bg-surface-1 rounded-lg border p-4">
	<div class="flex items-center justify-between gap-4">
		<h2 class="text-text text-sm font-medium">Registry</h2>
		<SaveButton form="package-registry-settings" pending={saving} />
	</div>
	<p class="text-text-muted mt-1 mb-4 text-sm">
		Turning it off removes its container and keeps its packages, so turning it
		back on picks up where it left off.
	</p>
	<form
		id="package-registry-settings"
		class="space-y-4"
		action="?/save"
		method="POST"
		use:enhance={queuedJobToast({
			error: `Couldn't change the ${info.title}.`,
			loading: "Queueing the change",
			onSettled: () => {
				saving = false;
			},
			onStart: () => {
				saving = true;
			},
			success: `The ${info.title} is being reconfigured in the background.`,
		})}
	>
		<CheckBox
			helperText="Starts the registry's container on the Homerun network. Every request needs a token from the Tokens tab."
			id="packageRegistryEnabled"
			label={`Run the ${info.title}`}
			name="enabled"
			bind:checked={enabled}
		/>
		<div>
			<label class="text-text mb-1.5 block text-sm font-medium" for="publicHost"
				>Public hostname</label
			>
			<Input
				id="publicHost"
				autocomplete="off"
				bind:value={publicHost}
				name="publicHost"
				placeholder={data.suggestedHost || `${info.hostPrefix}.example.com`}
			/>
			<p class="text-text-muted mt-1.5 text-xs">
				Routes the registry through Traefik at this hostname, so machines
				outside the Homerun network reach it. Leave it empty to keep it
				internal. Homerun creates the DNS record when a DNS provider is
				connected.
			</p>
		</div>
	</form>
</section>
