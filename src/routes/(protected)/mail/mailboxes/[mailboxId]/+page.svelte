<script lang="ts">
	import { enhance } from "$app/forms";
	import { MonitorSmartphone, Send } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import CopyButton from "#lib/components/copy-button.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import MailMailboxStorage from "#lib/components/mail-mailbox-storage.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	let sending = $state(false);
	const host = $derived(data.hostname ?? "mail.example.com");
</script>

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
			<dd class="text-text mt-0.5 font-mono text-xs">{host} · 993 · SSL/TLS</dd>
		</div>
		<div>
			<dt class="text-text-muted text-xs">Outgoing (SMTP)</dt>
			<dd class="text-text mt-0.5 font-mono text-xs">
				{host} · 465 · SSL/TLS, or 587 · STARTTLS
			</dd>
		</div>
	</dl>
</section>

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
