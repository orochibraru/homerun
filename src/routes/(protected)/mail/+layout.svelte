<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { AtSign, Forward, Globe, Server } from "@lucide/svelte";
	import { onMount } from "svelte";

	import TabNav, { type NavTab } from "#lib/components/tab-nav.svelte";
	import { title } from "#lib/store/title.js";

	const { children, data } = $props();

	onMount(() => {
		title.set("Mail");
	});

	interface RouteTab extends NavTab {
		href: string;
	}

	const tabs: RouteTab[] = $derived([
		{
			description: "Domains the server receives mail for, and their DNS",
			href: resolve("/(protected)/mail"),
			icon: Globe,
			id: "domains",
			label: "Domains",
			summary: `${data.mailStatus.domainCount} domains`,
		},
		{
			description: "Accounts people sign in to over IMAP and SMTP",
			href: resolve("/(protected)/mail/mailboxes"),
			icon: AtSign,
			id: "mailboxes",
			label: "Mailboxes",
			summary: `${data.mailStatus.mailboxCount} mailboxes`,
		},
		{
			description: "Addresses forwarding to other ones",
			href: resolve("/(protected)/mail/aliases"),
			icon: Forward,
			id: "aliases",
			label: "Aliases",
		},
		{
			description: "The container, its hostname and client settings",
			href: resolve("/(protected)/mail/server"),
			icon: Server,
			id: "server",
			label: "Server",
			summary: data.mailStatus.running ? "Running" : "Not running",
		},
	]);

	const activeTabId = $derived(
		tabs.find((tab) =>
			tab.id === "domains"
				? page.url.pathname === tab.href ||
					page.url.pathname.startsWith(`${tab.href}/domains`)
				: page.url.pathname.startsWith(tab.href),
		)?.id ?? "",
	);
</script>

<div class="p-5 md:p-6">
	<header class="mb-6">
		<h1 class="text-text text-2xl font-semibold max-md:hidden">Mail</h1>
		<p class="text-text-muted mt-1 text-sm">
			A mail server for your domains: docker-mailserver run by Homerun, with
			mailboxes, aliases and DKIM managed here.
		</p>
	</header>

	{#if data.mailStatus.enabled && data.mailStatus.stoppedReason}
		<p
			class="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-300"
		>
			{data.mailStatus.stoppedReason}
		</p>
	{:else if !data.mailStatus.enabled}
		<p
			class="border-border bg-surface-2 text-text-muted mb-4 rounded-md border px-4 py-3 text-sm"
		>
			The mail server is off. Turn it on from the
			<a
				class="text-accent underline"
				href={resolve("/(protected)/mail/server")}>Server</a
			> tab once a domain and a mailbox exist.
		</p>
	{/if}

	<TabNav active={activeTabId} {tabs}>
		{@render children()}
	</TabNav>
</div>
