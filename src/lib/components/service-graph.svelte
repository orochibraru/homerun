<script lang="ts">
	import { resolve } from "$app/paths";
	import { Unlink } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";

	import StatusBadge from "#lib/components/status-badge.svelte";
	import UnlinkDialog, {
		type UnlinkTarget,
	} from "#lib/components/unlink-dialog.svelte";
	import type { ContainerStatus } from "#lib/types.js";

	interface Node {
		id: string;
		keys: string[];
		name: string;
		slug: string;
		status: ContainerStatus;
	}

	interface Props {
		dependsOn: Node[];
		name: string;
		serviceId: string;
		usedBy: Node[];
	}

	const { name, dependsOn, serviceId, usedBy }: Props = $props();

	let unlinkOpen = $state(false);
	let unlink = $state<UnlinkTarget | null>(null);

	function askUnlink(item: Node, direction: "dependsOn" | "usedBy") {
		const self = { id: serviceId, name };
		const other = { id: item.id, name: item.name };
		unlink =
			direction === "dependsOn"
				? { from: self, keys: item.keys, to: other }
				: { from: other, keys: item.keys, to: self };
		unlinkOpen = true;
	}

	const groups = $derived(
		[
			{ direction: "dependsOn" as const, items: dependsOn, label: "Needs" },
			{ direction: "usedBy" as const, items: usedBy, label: "Used by" },
		].filter((group) => group.items.length > 0),
	);
</script>

<section class="panel rounded-[1.125rem] px-5 pt-4.5 pb-4">
	<h2
		class="text-text mb-3 text-[1.0625rem] font-[650] tracking-tight"
		title="Derived from environment variables pointing at another service's slug"
	>
		Connections
	</h2>

	{#if groups.length === 0}
		<p class="text-text-muted py-6 text-center text-sm">
			Nothing links to this service, and it references nothing else.
		</p>
	{:else}
		{#each groups as group, g (group.direction)}
			<p
				class="text-text-subtle mb-1.5 text-xs font-semibold {g > 0
					? 'mt-3'
					: ''}"
			>
				{group.label}
			</p>
			<div class="space-y-1.5">
				{#each group.items as item (item.id)}
					<div
						class="bg-surface-2 group flex items-center gap-2.5 rounded-[0.875rem] px-2.5 py-2.25"
					>
						<a
							class="flex min-w-0 flex-1 items-center gap-2.5"
							href={resolve("/(protected)/services/[serviceId]", {
								serviceId: item.id,
							})}
							title={item.keys.length > 0
								? `Through ${item.keys.join(", ")}`
								: "Dependency only, no env vars"}
						>
							<span
								class="text-accent grid size-7 shrink-0 place-items-center rounded-lg bg-[color-mix(in_oklch,var(--primary)_14%,transparent)] text-xs font-bold"
							>
								{item.name.charAt(0).toUpperCase()}
							</span>
							<span class="min-w-0 leading-tight">
								<span
									class="text-text block truncate text-[0.8125rem] font-bold group-hover:underline"
									>{item.name}</span
								>
								<span class="text-text-subtle block truncate text-[0.6875rem]"
									>{item.keys.length > 0
										? item.keys.join(", ")
										: item.slug}</span
								>
							</span>
						</a>
						<StatusBadge status={item.status} />
						<Button
							aria-label="Unlink {item.name}"
							class="text-text-subtle shrink-0 hover:text-red-500"
							onclick={() => askUnlink(item, group.direction)}
							size="icon-sm"
							title="Unlink"
							variant="ghost"
						>
							<Unlink class="size-3.5" />
						</Button>
					</div>
				{/each}
			</div>
		{/each}
	{/if}
</section>

<UnlinkDialog link={unlink} bind:open={unlinkOpen} />
