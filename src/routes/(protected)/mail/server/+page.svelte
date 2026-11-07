<script lang="ts">
	import { enhance } from "$app/forms";
	import { Globe, MonitorSmartphone, Server } from "@lucide/svelte";

	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { MAIL_PORTS } from "#lib/mail.js";

	const { data } = $props();

	const status = $derived(data.mailStatus);

	let enabled = $state(false);
	$effect(() => {
		enabled = status.enabled;
	});
	let hostname = $state("");
	$effect(() => {
		hostname = status.hostname ?? "";
	});
	let toggling = $state(false);
	let savingHost = $state(false);

	const host = $derived(status.hostname ?? "mail.example.com");
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="docker-mailserver with rspamd for spam filtering and DKIM signing. Mail and settings live in Docker volumes that survive turning it off."
		icon={Server}
		title="Mail server"
	>
		{#snippet trailing()}
			<SaveButton
				disabled={enabled === status.enabled}
				form="mail-enabled"
				pending={toggling}
			/>
		{/snippet}
	</PanelHeader>
	<div class="space-y-4 px-5 py-4">
		<dl class="grid gap-3 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-text-muted text-xs">Container</dt>
				<dd class="text-text mt-0.5">
					{status.running ? "Running" : "Not running"}
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">TLS certificate</dt>
				<dd class="text-text mt-0.5">
					{status.certificate
						? "From Traefik"
						: "Traefik's acme.json not found"}
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Mailboxes</dt>
				<dd class="text-text mt-0.5">{status.mailboxCount}</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Container name</dt>
				<dd class="text-text mt-0.5 font-mono text-xs">
					{status.containerName}
				</dd>
			</div>
		</dl>
		<form
			id="mail-enabled"
			action="?/setEnabled"
			method="POST"
			use:enhance={queuedJobToast({
				error: "Couldn't change the mail server.",
				loading: "Queueing the change",
				onSettled: () => {
					toggling = false;
				},
				onStart: () => {
					toggling = true;
				},
				success: "The mail server is being reconfigured in the background.",
			})}
		>
			<CheckBox
				helperText="Publishes ports 25, 465, 587 and 993 on this host. Turning it off stops the container; mail stays in its volumes."
				id="mailServerEnabled"
				label="Run the mail server"
				name="enabled"
				bind:checked={enabled}
			/>
		</form>
	</div>
</section>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="The name the server greets other servers with and every domain's MX points at. Traefik gets its certificate, its address record is created like the dashboard's."
		icon={Globe}
		title="Hostname"
	>
		{#snippet trailing()}
			<SaveButton form="mail-hostname" pending={savingHost} />
		{/snippet}
	</PanelHeader>
	<form
		id="mail-hostname"
		class="px-5 py-4"
		action="?/setHostname"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't change the hostname.",
			loading: "Saving the hostname",
			onSettled: () => {
				savingHost = false;
			},
			onStart: () => {
				savingHost = true;
			},
			success: "Hostname saved, the container is being updated.",
		})}
	>
		<label class={labelClass} for="mailHostname">Hostname</label>
		<input
			id="mailHostname"
			class="{inputClass} max-w-sm"
			autocomplete="off"
			name="hostname"
			placeholder={status.suggestedHostname || "mail.example.com"}
			bind:value={hostname}
		/>
	</form>
</section>

<section class="panel rounded-md">
	<PanelHeader
		description="What to type into a mail app. The username is always the full address."
		icon={MonitorSmartphone}
		title="Client settings"
	/>
	<div class="grid gap-4 px-5 py-4 text-sm sm:grid-cols-2">
		<dl class="space-y-2">
			<dt class="text-text-muted text-xs">Incoming (IMAP)</dt>
			<dd class="text-text font-mono text-xs">{host} · port 993 · SSL/TLS</dd>
			<dt class="text-text-muted text-xs">Outgoing (SMTP)</dt>
			<dd class="text-text font-mono text-xs">
				{host} · port 465 · SSL/TLS, or 587 · STARTTLS
			</dd>
		</dl>
		<div>
			<p class="text-text-muted mb-2 text-xs">Ports open to the internet</p>
			<ul class="space-y-1">
				{#each MAIL_PORTS as entry (entry.port)}
					<li class="text-text text-xs">
						<span class="font-mono">{entry.port}</span>
						<span class="text-text-muted">· {entry.label}</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>
