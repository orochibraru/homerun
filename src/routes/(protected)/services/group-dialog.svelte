<script lang="ts">
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		service: { id: string; name: string; stackId: string | null } | null;
		stacks: { id: string; name: string }[];
	}

	const { service, stacks }: Props = $props();

	let open = $state(false);
	let groupStackId = $state("");
	let newStackName = $state("");

	/** Opens the dialog preselecting the service's current stack, with the new-stack name cleared. */
	export function show(stackId: string | null): void {
		groupStackId = stackId ?? "";
		newStackName = "";
		open = true;
	}
</script>

<ResponsiveDialog
  description="Services in one stack share a Docker network and reach each other by slug."
  size="sm"
  title="Group {service?.name ?? 'service'}"
  bind:open
>
  <form
    action="?/group"
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
    {#if stacks.length > 0}
      <div>
        <label class={label} for="stackId">Existing stack</label>
        <SelectRoot name="stackId" type="single" bind:value={groupStackId}>
          <SelectTrigger class="w-full" id="stackId">
            {stacks.find((stack) => stack.id === groupStackId)?.name
            ?? "Select a stack"}
          </SelectTrigger>
          <SelectContent>
            {#each stacks as stack (stack.id)}
              <SelectItem label={stack.name} value={stack.id} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>
      <p class="text-text-subtle text-center text-xs">or</p>
    {/if}
    <div>
      <label class={label} for="newStackName">New stack</label>
      <Input
        id="newStackName"
        name="newStackName"
        placeholder="Acme"
        type="text"
        bind:value={newStackName}
      />
    </div>
    <div class="flex justify-end gap-2">
      <Button disabled={!(groupStackId || newStackName)} type="submit">
        Move
      </Button>
    </div>
  </form>
</ResponsiveDialog>
