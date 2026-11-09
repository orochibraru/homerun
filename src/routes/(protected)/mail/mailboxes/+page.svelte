<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { AtSign, Pencil, Plus } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { Switch } from "@orochibraru/ui/switch";

	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityList from "#lib/components/entity-list.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";

	const { data } = $props();

	const view = new ViewMode("mail-mailboxes");

	function usageLine(usage: { limitMb: number | null; usedMb: number } | null) {
		if (!usage) {
			return null;
		}
		const used = `${usage.usedMb.toFixed(1)} MB used`;
		return usage.limitMb ? `${used} of ${usage.limitMb} MB` : used;
	}

	const rows = $derived(
		data.mailboxes.map((box) => ({
			enabled: box.enabled,
			href: resolve("/(protected)/mail/mailboxes/[mailboxId]", {
				mailboxId: box.id,
			}),
			id: box.id,
			kind: box.kind,
			name: box.address,
			settingsHref: resolve(
				"/(protected)/mail/mailboxes/[mailboxId]/settings",
				{
					mailboxId: box.id,
				},
			),
			subtitle: [
				box.displayName,
				box.kind === "noreply"
					? "Send only, refuses incoming mail"
					: (usageLine(box.usage) ??
						(box.quotaMb ? `${box.quotaMb} MB quota` : "No quota")),
			]
				.filter(Boolean)
				.join(" · "),
			title: box.address,
		})),
	);
	type MailboxRow = (typeof rows)[number];
</script>

{#snippet media(_item: MailboxRow)}
	<div
		class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md"
	>
		<AtSign class="size-5" />
	</div>
{/snippet}

{#snippet badge(item: MailboxRow)}
	<span
		class="shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold {item.kind ===
		'noreply'
			? 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
			: 'bg-accent/10 text-accent'}"
	>
		{item.kind === "noreply" ? "Noreply" : "Mailbox"}
	</span>
	{#if !item.enabled}
		<span
			class="bg-surface-2 text-text-subtle shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
		>
			Disabled
		</span>
	{/if}
{/snippet}

{#snippet actions(item: MailboxRow)}
	<form
		id="toggle-{item.id}"
		action="?/toggle"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't change the mailbox.",
			loading: item.enabled ? "Disabling the mailbox" : "Enabling the mailbox",
			success: (result) =>
				result?.enabled ? "Mailbox enabled." : "Mailbox disabled.",
		})}
	>
		<input name="mailboxId" type="hidden" value={item.id} />
		<Switch
			aria-label={item.enabled ? "Disable mailbox" : "Enable mailbox"}
			checked={item.enabled}
			class="mx-1"
			onCheckedChange={() =>
				(
					document.getElementById(`toggle-${item.id}`) as HTMLFormElement | null
				)?.requestSubmit()}
		/>
	</form>
	<Button href={item.settingsHref} size="icon-sm" title="Edit" variant="ghost">
		<Pencil class="size-4" />
	</Button>
{/snippet}

<div class="mb-4 flex justify-end">
	<Button
		disabled={data.mailStatus.domainCount === 0}
		href={resolve("mail/mailboxes/new")}
		><Plus class="size-4" />New address</Button
	>
</div>

{#if rows.length === 0}
	<EmptyState
		icon={AtSign}
		subtitle={data.mailStatus.domainCount === 0
			? "Add a domain first, mailboxes live under one."
			: "Add one to start receiving mail."}
		title="No mailboxes yet"
	/>
{:else}
	<EntityList {actions} {badge} items={rows} {media} {view} />
{/if}
