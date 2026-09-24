<script lang="ts">
	import { FolderKanban } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		stackId: string | null;
		stacks: { id: string; name: string }[];
	}

	const { stackId: currentStackId, stacks }: Props = $props();

	let stackId = $derived(currentStackId ?? "");
	const stackLabel = $derived(
		stacks.find((p) => p.id === stackId)?.name ?? "Ungrouped",
	);
</script>

<section class="panel rounded-md">
  <div class="flex items-center justify-between gap-4 p-5">
    <div class="flex items-center gap-3">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <FolderKanban class="size-4" />
      </div>
      <div>
        <p class="text-text text-sm font-medium">Stack</p>
        <p class="text-text-muted text-xs">
          Move this service into a different stack, or ungroup it.
        </p>
      </div>
    </div>
    <form
      action="?/moveStack"
      class="flex w-75 items-center gap-2"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't move the service.",
        loading: "Moving the service",
        success: "Moved.",
      })}
    >
      <SelectRoot name="stackId" type="single" bind:value={stackId}>
        <SelectTrigger class="w-full">
          {stackLabel}
        </SelectTrigger>
        <SelectContent>
          <SelectItem label="Ungrouped" value="" />
          {#each stacks as stack (stack.id)}
            <SelectItem label={stack.name} value={stack.id} />
          {/each}
        </SelectContent>
      </SelectRoot>
      <Button class="shrink-0" type="submit" variant="outline">Move</Button>
    </form>
  </div>
</section>
