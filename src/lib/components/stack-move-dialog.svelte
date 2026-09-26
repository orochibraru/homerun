<script lang="ts">
	import { Check } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { labelClass as label } from "$lib/components/form-styles";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { descendantIds, type StackNode, stackPath } from "$lib/stack-tree";
	import { enhanceToast } from "$lib/toast";

	let {
		open = $bindable(false),
		stack,
		stacks,
	}: {
		open?: boolean;
		stack: StackNode | null;
		stacks: StackNode[];
	} = $props();

	let parentId = $state("");

	$effect(() => {
		if (open) {
			parentId = stack?.parentId ?? "";
		}
	});

	const options = $derived.by(() => {
		if (!stack) {
			return [];
		}
		const excluded = new Set([stack.id, ...descendantIds(stack.id, stacks)]);
		return stacks
			.filter((s) => !excluded.has(s.id))
			.map((s) => ({ id: s.id, path: stackPath(s.id, stacks) }))
			.sort((a, b) => a.path.localeCompare(b.path));
	});
</script>

<ResponsiveDialog
  description="A substack shows inside its parent's page, tree and diagram. Its services keep their slugs and hostnames."
  size="sm"
  title="Move {stack?.name ?? 'stack'}"
  bind:open
>
  {#if stack}
    <form
      action="{resolve('/(protected)/stacks/[stackId]/settings', {
        stackId: stack.id,
      })}?/move"
      class="space-y-4"
      method="POST"
      use:enhance={enhanceToast({
        error: `Couldn't move ${stack.name}.`,
        loading: `Moving ${stack.name}`,
        onSuccess: () => {
          open = false;
        },
        success: `${stack.name} moved.`,
      })}
    >
      <input name="parentId" type="hidden" value={parentId} />
      <div>
        <label class={label} for="move-parent">Parent stack</label>
        <SelectRoot type="single" bind:value={parentId}>
          <SelectTrigger class="w-full" id="move-parent">
            {options.find((o) => o.id === parentId)?.path ??
              "None, a top-level stack"}
          </SelectTrigger>
          <SelectContent>
            <SelectItem label="None, a top-level stack" value="" />
            {#each options as option (option.id)}
              <SelectItem label={option.path} value={option.id} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>
      <div class="flex justify-end">
        <Button type="submit">
          <Check class="size-4" />
          Move
        </Button>
      </div>
    </form>
  {/if}
</ResponsiveDialog>
