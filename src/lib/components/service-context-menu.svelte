<script lang="ts">
	import {
		Link2,
		Play,
		RotateCw,
		Settings as SettingsIcon,
		Square,
		Trash2,
		Wrench,
	} from "@lucide/svelte";
	import type { Snippet } from "svelte";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import * as ContextMenu from "$lib/components/ui/context-menu/index.js";

	interface Service {
		containerId: string | null;
		desiredState: string;
		id: string;
		name: string;
		stackId: string | null;
	}

	interface Props {
		children: Snippet;
		onaction: (op: "delete" | "restart" | "start" | "stop", id: string) => void;
		ongroup: (service: Service) => void;
		onlink: (service: Service) => void;
		onungroup: (service: Service) => void;
		service: Service;
	}

	const { service, children, onaction, onlink, ongroup, onungroup }: Props =
		$props();
</script>

<ContextMenu.Root>
  <ContextMenu.Trigger class="block h-full">
    {@render children()}
  </ContextMenu.Trigger>
  <ContextMenu.Content class="w-56">
    <ContextMenu.Item onSelect={() => onaction("restart", service.id)}>
      <RotateCw class="size-4" />
      Restart
    </ContextMenu.Item>
    {#if service.desiredState === "running"}
      <ContextMenu.Item onSelect={() => onaction("stop", service.id)}>
        <Square class="size-4" />
        Stop
      </ContextMenu.Item>
    {:else}
      <ContextMenu.Item
        disabled={!service.containerId}
        onSelect={() => onaction("start", service.id)}
      >
        <Play class="size-4" />
        Start
      </ContextMenu.Item>
    {/if}

    <ContextMenu.Separator />

    <ContextMenu.Item onSelect={() => onlink(service)}>
      <Link2 class="size-4" />
      Link to…
    </ContextMenu.Item>
    <ContextMenu.Item onSelect={() => ongroup(service)}>
      <Wrench class="size-4" />
      {service.stackId ? "Move to stack…" : "Group into stack…"}
    </ContextMenu.Item>
    {#if service.stackId}
      <ContextMenu.Item onSelect={() => onungroup(service)}>
        <Wrench class="size-4" />
        Ungroup
      </ContextMenu.Item>
    {/if}

    <ContextMenu.Separator />

    <ContextMenu.Item onSelect={() => goto(`${resolve("/services")}/${service.id}/settings`)}>
      <SettingsIcon class="size-4" />
      Settings
    </ContextMenu.Item>
    <ContextMenu.Item
      onSelect={() => onaction("delete", service.id)}
      variant="destructive"
    >
      <Trash2 class="size-4" />
      Delete
    </ContextMenu.Item>
  </ContextMenu.Content>
</ContextMenu.Root>
