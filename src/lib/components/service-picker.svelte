<script lang="ts" module>
	export interface PickableService {
		id: string;
		image: string;
		name: string;
		stackId: string | null;
	}
</script>

<script lang="ts">
	import { Check, ChevronsUpDown } from "@lucide/svelte";
	import { labelClass } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Command from "$lib/components/ui/command/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";

	interface Props {
		/** Prefix for the comboboxes' element ids, so a page can hold more than one picker. */
		id: string;
		services: PickableService[];
		/** The stack the service being linked is in: its services get their own combobox, above every other one. */
		stackId: string | null;
		stacks: { id: string; name: string }[];
		value: string;
	}

	let { id, services, stackId, stacks, value = $bindable() }: Props = $props();

	const stackNames = $derived(
		new Map(stacks.map((stack) => [stack.id, stack.name])),
	);
	const inStack = $derived(
		stackId ? services.filter((svc) => svc.stackId === stackId) : [],
	);
	const others = $derived(
		inStack.length > 0
			? services.filter((svc) => svc.stackId !== stackId)
			: services,
	);
	const groups = $derived(
		inStack.length > 0
			? [
					{
						key: "stack",
						label: `In ${stackNames.get(stackId ?? "") ?? "this stack"}`,
						list: inStack,
					},
					{ key: "others", label: "Other services", list: others },
				]
			: [{ key: "all", label: "Service", list: others }],
	);

	let openKey = $state<string | null>(null);

	/** Where a service lives, shown under its name: its stack's name, or that it has none. */
	function stackLabel(svc: PickableService): string {
		return svc.stackId
			? (stackNames.get(svc.stackId) ?? "Unknown stack")
			: "No stack";
	}
</script>

{#each groups as group (group.key)}
  {#if group.list.length > 0}
    {@const picked = group.list.find((svc) => svc.id === value)}
    <div>
      <label class={labelClass} for="{id}-{group.key}">{group.label}</label>
      <Popover.Root
        onOpenChange={(open) => {
          openKey = open ? group.key : null;
        }}
        open={openKey === group.key}
      >
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              class="h-auto min-h-9 w-full justify-between py-1.5"
              id="{id}-{group.key}"
              role="combobox"
              type="button"
              variant="outline"
            >
              {#if picked}
                <span class="flex min-w-0 flex-col items-start">
                  <span class="truncate">{picked.name}</span>
                  <span class="text-text-subtle truncate text-[0.6875rem]">
                    {stackLabel(picked)} · {picked.image}
                  </span>
                </span>
              {:else}
                <span class="text-text-muted truncate">Pick a service…</span>
              {/if}
              <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-(--bits-popover-anchor-width) p-0">
          <Command.Root>
            <Command.Input placeholder="Search services…" />
            <Command.List>
              <Command.Empty>No service matches.</Command.Empty>
              <Command.Group>
                {#each group.list as svc (svc.id)}
                  <Command.Item
                    keywords={[svc.image, stackLabel(svc)]}
                    onSelect={() => {
                      value = svc.id;
                      openKey = null;
                    }}
                    value="{svc.name} {svc.id}"
                  >
                    <Check
                      class="size-4 shrink-0 {value === svc.id ? '' : 'opacity-0'}"
                    />
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{svc.name}</span>
                      <span class="text-text-subtle truncate text-[0.6875rem]">
                        {stackLabel(svc)} · {svc.image}
                      </span>
                    </span>
                  </Command.Item>
                {/each}
              </Command.Group>
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>
    </div>
  {/if}
{/each}
