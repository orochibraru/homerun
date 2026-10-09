<script lang="ts">
	import { Check, ChevronsUpDown } from "@lucide/svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Command from "#lib/components/ui/command/index.js";
	import * as Popover from "#lib/components/ui/popover/index.js";
	import type { IacScopeOption } from "#lib/iac/generate.js";

	interface Props {
		allowNone?: boolean;
		id: string;
		name: string;
		scopes: IacScopeOption[];
		value: string;
	}

	let {
		allowNone = false,
		id,
		name,
		scopes,
		value = $bindable(),
	}: Props = $props();

	let open = $state(false);

	const selected = $derived(scopes.find((option) => option.value === value));
	const groups = $derived(
		(["Stacks", "Services"] as const)
			.map((group) => ({
				group,
				options: scopes.filter((option) => option.group === group),
			}))
			.filter((entry) => entry.options.length > 0),
	);

	function pick(next: string) {
		value = next;
		open = false;
	}
</script>

<input {name} type="hidden" {value}>
<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        class="w-full justify-between"
        {id}
        role="combobox"
        type="button"
        variant="outline"
      >
        <span class="truncate {selected ? '' : 'text-text-muted'}">
          {selected?.label ?? (allowNone ? "Nothing yet" : "Pick a stack or a service…")}
        </span>
        <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-(--bits-popover-anchor-width) p-0">
    <Command.Root>
      <Command.Input placeholder="Search stacks and services…" />
      <Command.List>
        <Command.Empty>No stack or service matches.</Command.Empty>
        {#if allowNone}
          <Command.Group>
            <Command.Item onSelect={() => pick("")} value="nothing yet">
              <Check class="size-4 shrink-0 {value ? 'opacity-0' : ''}" />
              <span class="text-text-muted">Nothing yet</span>
            </Command.Item>
          </Command.Group>
        {/if}
        {#each groups as entry (entry.group)}
          <Command.Group heading={entry.group}>
            {#each entry.options as option (option.value)}
              <Command.Item
                onSelect={() => pick(option.value)}
                value="{option.label} {option.value}"
              >
                <Check class="size-4 shrink-0 {value === option.value ? '' : 'opacity-0'}" />
                <span class="truncate">{option.label}</span>
              </Command.Item>
            {/each}
          </Command.Group>
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
