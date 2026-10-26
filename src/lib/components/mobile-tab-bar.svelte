<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { Bell, History, LayoutDashboard, Menu, Server } from "@lucide/svelte";
	import type { Component } from "svelte";

	import { mayVisit, type Permissions } from "#lib/permissions.js";
	import { getUnreadNotifications } from "#lib/remote/notifications.remote.js";

	let {
		menuButton = $bindable(null),
		menuOpen,
		onMenu,
		permissions,
	}: {
		menuButton?: HTMLElement | null;
		menuOpen: boolean;
		onMenu: () => void;
		permissions: Permissions;
	} = $props();

	interface BarItem {
		exact: boolean;
		href: string;
		icon: Component;
		label: string;
	}

	const unread = getUnreadNotifications();
	const unreadCount = $derived(unread.current?.unreadCount ?? 0);

	const items = $derived(
		(
			[
				{
					exact: true,
					href: resolve(""),
					icon: LayoutDashboard,
					label: "Home",
				},
				{
					exact: false,
					href: resolve("services"),
					icon: Server,
					label: "Services",
				},
				{
					exact: false,
					href: resolve("deployments"),
					icon: History,
					label: "Deploys",
				},
				{
					exact: false,
					href: resolve("notifications"),
					icon: Bell,
					label: "Alerts",
				},
			] satisfies BarItem[]
		).filter((item) => mayVisit(permissions, item.href)),
	);

	function isActive(item: BarItem): boolean {
		const path = page.url.pathname;
		return item.exact
			? path === item.href
			: path === item.href || path.startsWith(`${item.href}/`);
	}

	const itemClass =
		"group flex min-h-14 flex-1 flex-col items-center justify-center gap-1 text-[0.6875rem] outline-none transition-colors duration-150 focus-visible:text-text";
	const pillClass =
		"relative flex h-8 w-12 items-center justify-center rounded-2xl transition-[background-color,color,scale] duration-200 ease-snap group-active:scale-90";
	const activePill = "bg-ink text-ink-foreground shadow-sm";
	const idlePill = "bg-surface-2 text-text-muted";
</script>

<nav
	class="pointer-events-none absolute inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden"
	aria-label="Primary"
	data-slot="mobile-tab-bar"
>
	<div
		class="border-border bg-bg/88 pointer-events-auto flex items-stretch gap-0.5 rounded-[1.75rem] border px-1.5 py-1 shadow-xl backdrop-blur-xl"
	>
		{#each items as item (item.href)}
			{@const active = isActive(item)}
			{@const Icon = item.icon}
			<a
				class="{itemClass} {active
					? 'text-text font-semibold'
					: 'text-text-muted font-medium'}"
				aria-current={active ? "page" : undefined}
				href={item.href}
			>
				<span class="{pillClass} {active ? activePill : idlePill}">
					<Icon class="size-5.5" />
					{#if item.label === "Alerts" && unreadCount > 0}
						<span
							class="bg-accent text-bg ring-bg absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[0.625rem] leading-none font-bold ring-2"
						>
							{unreadCount > 9 ? "9+" : unreadCount}
						</span>
					{/if}
				</span>
				{item.label}
			</a>
		{/each}
		<button
			class="{itemClass} {menuOpen
				? 'text-text font-semibold'
				: 'text-text-muted font-medium'}"
			aria-expanded={menuOpen}
			aria-label="Open menu"
			bind:this={menuButton}
			onclick={onMenu}
			type="button"
		>
			<span class="{pillClass} {menuOpen ? activePill : idlePill}">
				<Menu class="size-5.5" />
			</span>
			Menu
		</button>
	</div>
</nav>
