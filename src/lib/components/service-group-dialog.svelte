<script lang="ts">
	import { Check, ChevronsUpDown, FolderKanban, Plus } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import * as Command from "$lib/components/ui/command/index.js";
	import * as Popover from "$lib/components/ui/popover/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		/** Path of the route whose form actions handle this dialog, e.g. `/services`; empty for the current route. */
		actionBase?: string;
		service: { id: string; name: string; stackId: string | null } | null;
		stacks: { id: string; name: string }[];
	}

	const { actionBase = "", service, stacks }: Props = $props();

	let open = $state(false);
	let pickerOpen = $state(false);
	let groupStackId = $state("");
	let newStackName = $state("");
	let search = $state("");

	const typed = $derived(search.trim());
	const canCreate = $derived(
		typed !== "" &&
			!stacks.some((stack) => stack.name.toLowerCase() === typed.toLowerCase()),
	);
	const pickedLabel = $derived(
		newStackName
			? `New stack "${newStackName}"`
			: (stacks.find((stack) => stack.id === groupStackId)?.name ?? null),
	);

	/** Opens the dialog preselecting the service's current stack, with the new-stack name cleared. */
	export function show(stackId: string | null): void {
		groupStackId = stackId ?? "";
		newStackName = "";
		search = "";
		open = true;
	}

	function pickExisting(id: string): void {
		groupStackId = id;
		newStackName = "";
		pickerOpen = false;
	}

	function pickNew(): void {
		groupStackId = "";
		newStackName = typed;
		pickerOpen = false;
	}
</script>

<ResponsiveDialog
  description="Services in one stack share a Docker network and reach each other by slug."
  size="sm"
  title="Group {service?.name ?? 'service'}"
  bind:open
>
  <form
    action="{actionBase}?/group"
    class="space-y-4"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't move the service.",
      loading: "Moving the service",
      onSuccess: () => {
        open = false;
      },
      success: "Moved.",
    })}
  >
    <input name="serviceId" type="hidden" value={service?.id ?? ""}>
    <input name="stackId" type="hidden" value={groupStackId}>
    <input name="newStackName" type="hidden" value={newStackName}>
    <div>
      <label class={label} for="stackPicker">Stack</label>
      <Popover.Root bind:open={pickerOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              class="w-full justify-between"
              id="stackPicker"
              role="combobox"
              type="button"
              variant="outline"
            >
              <span class="flex min-w-0 items-center gap-2">
                <FolderKanban class="size-4 shrink-0" />
                <span class="truncate {pickedLabel ? '' : 'text-text-muted'}">
                  {pickedLabel ?? "Pick or create a stack…"}
                </span>
              </span>
              <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-(--bits-popover-anchor-width) p-0">
          <Command.Root>
            <Command.Input
              placeholder="Search or name a new stack…"
              bind:value={search}
            />
            <Command.List>
              {#if !canCreate}
                <Command.Empty>No stacks yet : type a name.</Command.Empty>
              {/if}
              {#if stacks.length > 0}
                <Command.Group>
                  {#each stacks as stack (stack.id)}
                    <Command.Item
                      onSelect={() => pickExisting(stack.id)}
                      value={stack.name}
                    >
                      <Check
                        class="size-4 {groupStackId === stack.id
                        ? ''
                        : 'opacity-0'}"
                      />
                      <span class="truncate">{stack.name}</span>
                    </Command.Item>
                  {/each}
                </Command.Group>
              {/if}
              {#if canCreate}
                <Command.Group forceMount>
                  <Command.Item
                    forceMount
                    onSelect={pickNew}
                    value="create-new-stack"
                  >
                    <Plus class="size-4" />
                    <span class="truncate">Create "{typed}"</span>
                  </Command.Item>
                </Command.Group>
              {/if}
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>
    </div>
    <div class="flex justify-end gap-2">
      <Button disabled={!(groupStackId || newStackName)} type="submit">
        Move
      </Button>
    </div>
  </form>
</ResponsiveDialog>
