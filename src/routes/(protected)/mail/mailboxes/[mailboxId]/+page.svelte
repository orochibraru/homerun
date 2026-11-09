<script lang="ts">
	import { enhance } from "$app/forms";
	import { KeySquare, MonitorSmartphone, Send } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import CopyButton from "#lib/components/copy-button.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import MailMailboxStorage from "#lib/components/mail-mailbox-storage.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	let sending = $state(false);
	const host = $derived(data.hostname ?? "mail.example.com");
	const smtpEnv = $derived(
		[
			`SMTP_HOST=${host}`,
			"SMTP_PORT=587",
			"SMTP_SECURE=false",
			`SMTP_USER=${data.mailbox.address}`,
			"SMTP_PASSWORD=<the password set for it>",
			`SMTP_FROM=${data.mailbox.address}`,
		].join("\n"),
	);
</script>

{#if data.mailbox.kind === "noreply"}
	<section class="panel mb-6 rounded-md">
		<PanelHeader
			description="A send-only address: give these to an app so it sends its mail from here. It has no inbox, mail sent to it is refused. Services on Homerun reach the mail server at this hostname directly."
			icon={KeySquare}
			title="SMTP credentials"
		>
			{#snippet trailing()}
				<CopyButton
					label="the SMTP settings as env"
					text="Copy as env"
					value={smtpEnv}
				/>
			{/snippet}
		</PanelHeader>
		<dl class="grid gap-4 px-5 py-4 text-sm sm:grid-cols-4">
			<div>
				<dt class="text-text-muted text-xs">Host</dt>
				<dd class="text-text mt-0.5 flex items-center gap-1 font-mono text-xs">
					{host}<CopyButton value={host} />
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Port</dt>
				<dd class="text-text mt-0.5 font-mono text-xs">
					587 · STARTTLS, or 465 · SSL/TLS
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Username and From</dt>
				<dd class="text-text mt-0.5 flex items-center gap-1 font-mono text-xs">
					{data.mailbox.address}<CopyButton value={data.mailbox.address} />
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Password</dt>
				<dd class="text-text mt-0.5 text-xs">
					The one set for it, changed from Settings
				</dd>
			</div>
		</dl>
		<pre
			class="border-border bg-surface-2 text-text mx-5 mb-4 overflow-x-auto rounded-md border p-3 font-mono text-xs">{smtpEnv}</pre>
	</section>
{:else}
	<MailMailboxStorage contents={data.contents} />

	<section class="panel mb-6 rounded-md">
		<PanelHeader
			description="What to type into a mail app for this mailbox."
			icon={MonitorSmartphone}
			title="Sign-in details"
		/>
		<dl class="grid gap-4 px-5 py-4 text-sm sm:grid-cols-3">
			<div>
				<dt class="text-text-muted text-xs">Username</dt>
				<dd class="text-text mt-0.5 flex items-center gap-1 font-mono text-xs">
					{data.mailbox.address}<CopyButton value={data.mailbox.address} />
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Incoming (IMAP)</dt>
				<dd class="text-text mt-0.5 font-mono text-xs">
					{host} · 993 · SSL/TLS
				</dd>
			</div>
			<div>
				<dt class="text-text-muted text-xs">Outgoing (SMTP)</dt>
				<dd class="text-text mt-0.5 font-mono text-xs">
					{host} · 465 · SSL/TLS, or 587 · STARTTLS
				</dd>
			</div>
		</dl>
	</section>
{/if}

<section class="panel rounded-md">
	<PanelHeader
		description="Sends a short message from this mailbox, signed with the domain's DKIM key. Send it to an address elsewhere, or to a checker like mail-tester.com, to see that outgoing mail arrives and isn't marked as spam."
		icon={Send}
		title="Send a test email"
	/>
	<form
		action="?/sendTest"
		class="flex flex-wrap items-end gap-3 px-5 py-4"
		method="POST"
		use:enhance={enhanceToast({
			error: "Couldn't send the test email.",
			loading: "Handing the message to the mail server",
			onSettled: () => {
				sending = false;
			},
			onStart: () => {
				sending = true;
			},
			success: (result) =>
				typeof result?.recipient === "string"
					? `Queued for ${result.recipient}. Check its inbox, and the Server tab's queue if it doesn't show up.`
					: "Test email queued.",
		})}
	>
		<div class="min-w-64 flex-1">
			<label class={labelClass} for="mailTestRecipient">Send to</label>
			<input
				id="mailTestRecipient"
				class={inputClass}
				autocomplete="email"
				name="recipient"
				placeholder="you@elsewhere.com"
				required
				type="email"
			/>
		</div>
		<Button disabled={sending} type="submit" variant="outline"
			><Send class="size-4" />Send</Button
		>
	</form>
</section>
