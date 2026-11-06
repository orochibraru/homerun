<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { ArrowUpCircle, Power, PowerOff } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { onMount } from "svelte";

	import PanelHeader from "#lib/components/panel-header.svelte";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();
	const host = $derived(data.host);

	onMount(() => title.set(host.name));

	let toggling = $state(false);
	let updating = $state(false);
</script>

<div class="grid gap-6 lg:grid-cols-2">
	<section class="panel rounded-md">
		<PanelHeader title="Status" />
		<div class="space-y-2 p-5 text-sm">
			{#if host.kind === "agent"}
				{#if data.agentStatus?.reachable}
					<p class="flex items-center gap-2">
						<span class="inline-block size-2 rounded-full bg-green-500"></span>
						<span class="text-text">Online</span>
						<span class="text-text-subtle"
							>· agent v{data.agentStatus.version}</span
						>
					</p>
				{:else}
					<p class="flex items-center gap-2">
						<span class="inline-block size-2 rounded-full bg-red-500"></span>
						<span class="text-red-600 dark:text-red-400">
							Unreachable{data.agentStatus?.error
								? ` : ${data.agentStatus.error}`
								: ""}
						</span>
					</p>
				{/if}
				<p class="text-text-muted">{host.agentUrl}</p>
			{:else}
				<p class="text-text">{host.dockerHost}</p>
			{/if}
		</div>
	</section>

	<section class="panel rounded-md">
		<PanelHeader title="Availability" />
		<form
			class="flex flex-wrap items-center justify-between gap-4 p-5"
			action="?/setEnabled"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't change the host.",
				loading: host.enabled ? "Disabling the host" : "Enabling the host",
				onSettled: () => {
					toggling = false;
				},
				onStart: () => {
					toggling = true;
				},
				success: (result) =>
					result?.enabled ? "Host enabled." : "Host disabled.",
			})}
		>
			<input name="enabled" type="hidden" value={String(!host.enabled)} />
			<p class="text-text-muted text-sm">
				{#if host.enabled}
					Takes new builds and workstations.
				{:else}
					Disabled: no new build or workstation lands here. What already runs on
					it keeps running, and a service pinned to it fails its build until
					it's enabled again.
				{/if}
			</p>
			<Button
				disabled={toggling}
				type="submit"
				variant={host.enabled ? "outline" : "default"}
			>
				{#if host.enabled}
					<PowerOff class="size-4" />Disable
				{:else}
					<Power class="size-4" />Enable
				{/if}
			</Button>
		</form>
	</section>

	{#if host.kind === "agent"}
		<section class="panel rounded-md lg:col-span-2">
			<PanelHeader title="Version" />
			<form
				class="flex flex-wrap items-center justify-between gap-4 p-5"
				action="?/upgrade"
				method="POST"
				use:enhance={enhanceToast({
					error: "Couldn't update the agent.",
					loading: `Updating the agent to v${data.instanceVersion}`,
					onSettled: () => {
						updating = false;
					},
					onStart: () => {
						updating = true;
					},
					success: (result) =>
						`The agent is restarting on v${result?.version ?? data.instanceVersion}, once any build it runs finishes.`,
				})}
			>
				<p class="text-text-muted text-sm">
					{#if !data.agentStatus?.reachable}
						The agent's version shows once it answers.
					{:else if data.updateAvailable}
						Runs v{data.agentStatus.version}, this instance runs v{data.instanceVersion}.
						Updating downloads that release on the host and restarts the agent
						into it.
					{:else}
						Runs v{data.agentStatus.version}, the same as this instance.
					{/if}
				</p>
				{#if data.updateAvailable}
					<Button disabled={updating} type="submit">
						<ArrowUpCircle class="size-4" />Update to v{data.instanceVersion}
					</Button>
				{/if}
			</form>
			<p class="text-text-subtle px-5 pb-5 text-xs">
				An agent installed before self-update can't replace its own binary:
				re-run the installer on that host once. Its log is on the
				<a
					class="underline"
					href={resolve("/(protected)/remote-hosts/[hostId]/logs", {
						hostId: host.id,
					})}>Logs</a
				> tab.
			</p>
		</section>
	{/if}
</div>
