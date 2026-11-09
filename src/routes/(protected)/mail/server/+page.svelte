<script lang="ts">
	import { enhance } from "$app/forms";
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		Archive,
		ExternalLink,
		Globe,
		Mail,
		MonitorSmartphone,
		Rocket,
		RotateCw,
		Send,
		Server,
		Stethoscope,
	} from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import CheckBox from "#lib/components/check-box.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import MailCheckList from "#lib/components/mail-check-list.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import PasswordField from "#lib/components/password-field.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { type MailCheck, overallState } from "#lib/mail-doveadm.js";
	import { MAIL_PORTS } from "#lib/mail.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	let checks = $state<MailCheck[] | null>(null);
	let testing = $state(false);
	let deploying = $state(false);

	const status = $derived(data.mailStatus);

	let enabled = $derived(status.enabled);
	let hostname = $derived(status.hostname ?? "");
	let toggling = $state(false);
	let restarting = $state(false);
	let savingHost = $state(false);
	let savingRelay = $state(false);
	let addingVolume = $state(false);
	let relayPassword = $state("");

	const host = $derived(status.hostname ?? "mail.example.com");
	const overall = $derived(checks ? overallState(checks) : null);
</script>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="Checks the container, each port at the hostname's public address (probed from this server, so not proof the whole internet gets through), the certificate, sending out (on port 25, or to the outbound relay), reverse DNS, the queue and each domain's records. It changes nothing."
		icon={Stethoscope}
		title="Self-test"
	>
		{#snippet trailing()}
			<form
				action="?/selfTest"
				method="POST"
				use:enhance={enhanceToast({
					error: "Couldn't run the self-test.",
					loading: "Testing the mail server",
					onSettled: () => {
						testing = false;
					},
					onStart: () => {
						testing = true;
					},
					onSuccess: (result) => {
						checks = Array.isArray(result?.checks)
							? (result.checks as MailCheck[])
							: null;
					},
					success: "Self-test finished.",
				})}
			>
				<Button disabled={testing} size="sm" type="submit" variant="outline"
					><Stethoscope class="size-4" />{testing
						? "Testing…"
						: "Run self-test"}</Button
				>
			</form>
		{/snippet}
	</PanelHeader>
	{#if checks}
		<p
			class="border-border border-b px-5 py-3 text-sm {overall === 'ok'
				? 'text-emerald-600 dark:text-emerald-400'
				: overall === 'warn'
					? 'text-amber-600 dark:text-amber-400'
					: 'text-red-600 dark:text-red-400'}"
		>
			{overall === "ok"
				? "Everything passed."
				: overall === "warn"
					? "Works, with warnings worth fixing."
					: "Something's broken: see the red lines."}
		</p>
		<MailCheckList {checks} />
	{:else}
		<p class="text-text-muted px-5 py-4 text-sm">
			Run it after setting up a domain, and whenever mail stops arriving or
			leaving. Ports are probed from this server at the hostname's public
			address, which isn't proof the whole internet gets through: a router
			without hairpin NAT can fail them while outside clients connect fine.
		</p>
	{/if}
</section>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="docker-mailserver with rspamd for spam filtering and DKIM signing. Mail and settings live in Docker volumes that survive turning it off."
		icon={Server}
		title="Mail server"
	>
		{#snippet trailing()}
			<div class="flex items-center gap-2">
				{#if status.health?.exists}
					<form
						action="?/restart"
						method="POST"
						use:enhance={enhanceToast({
							error: "Couldn't restart the mail server.",
							loading: "Restarting the mail server",
							onComplete: () => refreshAll(),
							onSettled: () => {
								restarting = false;
							},
							onStart: () => {
								restarting = true;
							},
							success: "Mail server restarted.",
						})}
					>
						<Button
							disabled={restarting}
							size="sm"
							type="submit"
							variant="outline"
						>
							<RotateCw class="size-4" />
							Restart
						</Button>
					</form>
				{/if}
				<SaveButton
					disabled={enabled === status.enabled}
					form="mail-enabled"
					pending={toggling}
				/>
			</div>
		{/snippet}
	</PanelHeader>
	<div class="space-y-4 px-5 py-4">
		<dl class="grid gap-3 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-text-muted text-xs">Container</dt>
				<dd class="text-text mt-0.5">
					{status.running
						? "Running"
						: status.health?.restarting
							? `Restarting (${status.health.restartCount} restarts)`
							: "Not running"}
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

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="A smarthost every outgoing message is handed to instead of being delivered on port 25: for a host whose provider blocks outbound 25, or whose address has no matching reverse DNS. Add the relay's servers to each domain's SPF record too. Leave the host empty to deliver directly."
		icon={Send}
		title="Outbound relay"
	>
		{#snippet trailing()}
			<SaveButton form="mail-relay" pending={savingRelay} />
		{/snippet}
	</PanelHeader>
	<form
		id="mail-relay"
		class="grid gap-4 px-5 py-4 sm:grid-cols-2 xl:grid-cols-4"
		action="?/setRelay"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't save the relay.",
			loading: "Saving the relay",
			onSettled: () => {
				savingRelay = false;
			},
			onStart: () => {
				savingRelay = true;
			},
			onSuccess: () => {
				relayPassword = "";
			},
			success: "Relay saved, the container is being updated.",
		})}
	>
		<div>
			<label class={labelClass} for="mailRelayHost">Host</label>
			<input
				id="mailRelayHost"
				class={inputClass}
				autocomplete="off"
				name="relayHost"
				placeholder="smtp.relay.example"
				value={data.relay.host ?? ""}
			/>
		</div>
		<div>
			<label class={labelClass} for="mailRelayPort">Port</label>
			<input
				id="mailRelayPort"
				class={inputClass}
				max="65535"
				min="1"
				name="relayPort"
				placeholder="587"
				type="number"
				value={data.relay.port ?? ""}
			/>
		</div>
		<div>
			<label class={labelClass} for="mailRelayUser">Username</label>
			<input
				id="mailRelayUser"
				class={inputClass}
				autocomplete="off"
				name="relayUser"
				placeholder="None"
				value={data.relay.user ?? ""}
			/>
		</div>
		<PasswordField
			autocomplete="new-password"
			id="mailRelayPassword"
			label="Password"
			name="relayPassword"
			placeholder={data.relay.hasPassword
				? "Saved, leave empty to keep it"
				: "None"}
			bind:value={relayPassword}
		/>
	</form>
</section>

<section class="panel mb-6 rounded-md">
	<PanelHeader
		description="Every mailbox's mail lives in the homerun-mail-data Docker volume. Add it to Storage to back it up like a service volume: a schedule and a destination on its page. Turn the mail server off before restoring into it."
		icon={Archive}
		title="Backups"
	>
		{#snippet trailing()}
			{#if data.dataVolume}
				<Button
					href={resolve("/(protected)/storage/[volumeId]", {
						volumeId: data.dataVolume.id,
					})}
					size="sm"
					variant="outline">Open in Storage</Button
				>
			{:else}
				<form
					action="?/addDataVolume"
					method="POST"
					use:enhance={enhanceToast({
						error: "Couldn't add the volume to Storage.",
						loading: "Adding the mail volume to Storage",
						onSettled: () => {
							addingVolume = false;
						},
						onStart: () => {
							addingVolume = true;
						},
						success: "Added. Set its schedule and destination here.",
					})}
				>
					<Button
						disabled={addingVolume}
						size="sm"
						type="submit"
						variant="outline"><Archive class="size-4" />Add to Storage</Button
					>
				</form>
			{/if}
		{/snippet}
	</PanelHeader>
	<p class="text-text-muted px-5 py-4 text-sm">
		{data.dataVolume
			? data.dataVolume.backupEnabled
				? "Backed up on its schedule, see Backups for each run."
				: "In Storage, with backups off: turn them on from its page."
			: "Not in Storage yet, so not backed up."}
	</p>
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

<section class="panel mt-6 rounded-md">
	<PanelHeader
		description="Roundcube, deployed as an ordinary service from the built-in template and already pointed at this mail server. Give it a domain of its own from its Networking tab."
		icon={Mail}
		title="Mail client"
	>
		{#snippet trailing()}
			<form
				action="?/deployWebmail"
				method="POST"
				use:enhance={enhanceToast({
					error: "Couldn't deploy Roundcube.",
					loading: "Creating the Roundcube service",
					onSettled: () => {
						deploying = false;
					},
					onStart: () => {
						deploying = true;
					},
					success: "Roundcube is deploying.",
				})}
			>
				<Button disabled={deploying || !status.hostname} size="sm" type="submit"
					><Rocket class="size-4" />Deploy Roundcube</Button
				>
			</form>
		{/snippet}
	</PanelHeader>
	{#if form?.error}
		<p class="px-5 pt-4 text-sm text-red-500">{form.error}</p>
	{/if}
	{#if data.webmail.length === 0}
		<p class="text-text-muted px-5 py-4 text-sm">
			No mail client deployed yet.
		</p>
	{:else}
		<ul class="divide-border divide-y">
			{#each data.webmail as client (client.id)}
				<li class="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
					<a
						class="text-text text-sm font-medium hover:underline"
						href={resolve("/(protected)/services/[serviceId]", {
							serviceId: client.id,
						})}>{client.name}</a
					>
					<Button
						href={client.url}
						rel="noopener noreferrer"
						size="sm"
						target="_blank"
						variant="ghost"><ExternalLink class="size-4" />Open</Button
					>
				</li>
			{/each}
		</ul>
	{/if}
</section>
