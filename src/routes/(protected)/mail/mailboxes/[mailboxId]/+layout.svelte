<script lang="ts">
	import { resolve } from "$app/paths";
	import { ArrowLeft, Inbox, Settings } from "@lucide/svelte";

	import SectionNav from "#lib/components/section-nav.svelte";

	const { children, data } = $props();

	const params = $derived({ mailboxId: data.mailbox.id });
	const sections = $derived([
		{
			href: resolve("/(protected)/mail/mailboxes/[mailboxId]", params),
			icon: Inbox,
			label: "Overview",
		},
		{
			href: resolve("/(protected)/mail/mailboxes/[mailboxId]/settings", params),
			icon: Settings,
			label: "Settings",
		},
	]);
</script>

<a
	class="text-text-muted hover:text-text mb-5 inline-flex items-center gap-1 text-sm"
	href={resolve("mail/mailboxes")}
>
	<ArrowLeft class="size-4" />
	All mailboxes
</a>

<div class="mb-6">
	<h2 class="text-text text-lg font-semibold tracking-tight">
		{data.mailbox.address}
		{#if !data.mailbox.enabled}
			<span
				class="bg-surface-2 text-text-subtle ml-1.5 rounded-full px-2 py-0.5 align-middle text-[0.65rem] font-semibold"
			>
				Disabled
			</span>
		{/if}
	</h2>
	{#if data.mailbox.displayName}
		<p class="text-text-muted mt-1 text-sm">{data.mailbox.displayName}</p>
	{/if}
</div>

<SectionNav hubLabel="Mailbox" label="Mailbox sections" {sections}>
	{@render children()}
</SectionNav>
