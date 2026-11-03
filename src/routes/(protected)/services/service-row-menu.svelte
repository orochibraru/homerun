<script lang="ts">
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import {
		Ellipsis,
		Link2,
		Play,
		RotateCw,
		Settings as SettingsIcon,
		Square,
		Trash2,
		Wrench,
	} from "@lucide/svelte";
	import * as DropdownMenu from "@orochibraru/ui/dropdown-menu";

	import type { ServiceAction } from "#lib/service-actions.js";

	interface Service {
		containerId: string | null;
		desiredState: string;
		id: string;
		name: string;
		stackId: string | null;
	}

	interface Props {
		onaction: (op: ServiceAction, id: string) => void;
		ongroup: (service: Service) => void;
		onlink: (service: Service) => void;
		onungroup: (service: Service) => void;
		service: Service;
	}

	const { onaction, ongroup, onlink, onungroup, service }: Props = $props();
</script>

<DropdownMenu.Root>
	<DropdownMenu.Trigger>
		{#snippet child({ props })}
			<button
				{...props}
				class="text-text-subtle hover:bg-surface-3 hover:text-text relative z-10 grid size-7 place-items-center rounded-full transition-colors"
				aria-label="Actions for {service.name}"
				type="button"
			>
				<Ellipsis class="size-4.5" />
			</button>
		{/snippet}
	</DropdownMenu.Trigger>
	<DropdownMenu.Content align="end" class="w-56">
		<DropdownMenu.Item onSelect={() => onaction("restart", service.id)}>
			<RotateCw class="size-4" />
			Restart
		</DropdownMenu.Item>
		{#if service.desiredState === "running"}
			<DropdownMenu.Item onSelect={() => onaction("stop", service.id)}>
				<Square class="size-4" />
				Stop
			</DropdownMenu.Item>
		{:else}
			<DropdownMenu.Item
				disabled={!service.containerId}
				onSelect={() => onaction("start", service.id)}
			>
				<Play class="size-4" />
				Start
			</DropdownMenu.Item>
		{/if}

		<DropdownMenu.Separator />

		<DropdownMenu.Item onSelect={() => onlink(service)}>
			<Link2 class="size-4" />
			Link to…
		</DropdownMenu.Item>
		<DropdownMenu.Item onSelect={() => ongroup(service)}>
			<Wrench class="size-4" />
			{service.stackId ? "Move to stack…" : "Group into stack…"}
		</DropdownMenu.Item>
		{#if service.stackId}
			<DropdownMenu.Item onSelect={() => onungroup(service)}>
				<Wrench class="size-4" />
				Ungroup
			</DropdownMenu.Item>
		{/if}

		<DropdownMenu.Separator />

		<DropdownMenu.Item
			onSelect={() => goto(`${resolve("services")}/${service.id}/settings`)}
		>
			<SettingsIcon class="size-4" />
			Settings
		</DropdownMenu.Item>
		<DropdownMenu.Item
			onSelect={() => onaction("delete", service.id)}
			variant="destructive"
		>
			<Trash2 class="size-4" />
			Delete
		</DropdownMenu.Item>
	</DropdownMenu.Content>
</DropdownMenu.Root>
