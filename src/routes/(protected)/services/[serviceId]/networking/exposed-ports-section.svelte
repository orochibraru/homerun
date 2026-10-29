<script lang="ts">
	import { enhance } from "$app/forms";
	import { DoorOpen } from "@lucide/svelte";

	import ExposedPortsFields from "#lib/components/exposed-ports-fields.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import type { ExposedPort } from "#lib/published-ports.js";
	import { enhanceToast } from "#lib/toast.js";

	interface Props {
		svc: {
			exposedPorts: ExposedPort[];
			networkMode: string;
		};
	}

	const { svc }: Props = $props();

	let submitting = $state(false);
</script>

<section class="panel rounded-md">
	<PanelHeader
		description="Declare other ports the container listens on, like compose's expose: (Docker's ExposedPorts). It documents them and shows them in docker inspect; it opens nothing. Services on the same network already reach every port by slug, and nothing outside does."
		icon={DoorOpen}
		title="Exposed ports"
	>
		{#snippet trailing()}
			{#if svc.networkMode !== "host"}
				<SaveButton form="service-exposed-ports" pending={submitting} />
			{/if}
		{/snippet}
	</PanelHeader>

	{#if svc.networkMode === "host"}
		<p class="text-text-muted p-5 text-sm">
			Host networking already exposes every port the container listens on.
		</p>
	{:else}
		<form
			id="service-exposed-ports"
			action="?/updateExposedPorts"
			class="space-y-3 p-5"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't save the exposed ports.",
				loading: "Saving exposed ports",
				onSettled: () => {
					submitting = false;
				},
				onStart: () => {
					submitting = true;
				},
				success: "Saved. Redeploy for it to take effect.",
			})}
		>
			<ExposedPortsFields ports={svc.exposedPorts} />

			<p class="text-text-subtle text-xs">
				Redeploy for changes to take effect. Ignored in swarm mode, where Docker
				has no per-service equivalent.
			</p>
		</form>
	{/if}
</section>
