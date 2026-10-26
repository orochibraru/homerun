<script lang="ts">
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import { LaptopMinimal, LayoutGrid, Plus, Rocket } from "@lucide/svelte";
	import type { Component } from "svelte";

	import * as Drawer from "#lib/components/ui/drawer/index.js";
	import { can, mayVisit, type Permissions } from "#lib/permissions.js";

	const { permissions }: { permissions: Permissions } = $props();

	interface CreateAction {
		description: string;
		href: string;
		icon: Component;
		label: string;
	}

	let open = $state(false);

	const SHOWN_ON: string[] = [
		resolve(""),
		resolve("services"),
		resolve("stacks"),
		resolve("templates"),
		resolve("workstations"),
	];
	const shown = $derived(SHOWN_ON.includes(page.url.pathname));

	const actions = $derived.by(() => {
		const list: CreateAction[] = [];
		if (can(permissions, "services", "write")) {
			list.push({
				description: "From an image, a git repository or a compose file",
				href: resolve("services/new"),
				icon: Rocket,
				label: "Deploy a service",
			});
		}
		if (can(permissions, "workstations", "write")) {
			list.push({
				description: "A cloud dev environment in the browser",
				href: resolve("workstations/new"),
				icon: LaptopMinimal,
				label: "New workstation",
			});
		}
		if (mayVisit(permissions, resolve("templates"))) {
			list.push({
				description: "One-click apps ready to deploy",
				href: resolve("templates"),
				icon: LayoutGrid,
				label: "Browse templates",
			});
		}
		return list;
	});
</script>

{#if shown && actions.length > 0}
	<Drawer.Root bind:open>
		<Drawer.Trigger
			class="bg-ink text-ink-foreground absolute right-4 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+5.25rem)] z-30 flex size-14 items-center justify-center rounded-2xl shadow-xl transition-transform active:scale-95 md:hidden"
			aria-label="Create"
			data-slot="mobile-create-fab"
		>
			<Plus class="size-6" />
		</Drawer.Trigger>
		<Drawer.Content class="md:hidden">
			<Drawer.Header class="pb-1 text-left">
				<Drawer.Title>Create</Drawer.Title>
			</Drawer.Header>
			<nav
				class="flex flex-col gap-1.5 px-3 pb-[calc(1rem+env(safe-area-inset-bottom))]"
			>
				{#each actions as action (action.href)}
					{@const Icon = action.icon}
					<a
						class="border-border bg-surface active:bg-surface-2 flex min-h-14 items-center gap-3 rounded-xl border px-2 py-1.5"
						href={action.href}
						onclick={() => (open = false)}
					>
						<span
							class="bg-accent-light text-accent flex size-9 shrink-0 items-center justify-center rounded-lg"
						>
							<Icon class="size-4.5" />
						</span>
						<span class="flex min-w-0 flex-col">
							<span class="text-text text-sm font-medium">{action.label}</span>
							<span class="text-text-subtle truncate text-[0.6875rem]"
								>{action.description}</span
							>
						</span>
					</a>
				{/each}
			</nav>
		</Drawer.Content>
	</Drawer.Root>
{/if}
