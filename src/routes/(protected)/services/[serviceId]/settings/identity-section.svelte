<script lang="ts">
	import { Check, Palette, Server } from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import IconPicker from "$lib/components/icon-picker.svelte";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import {
		TEMPLATE_CATEGORIES,
		templateCategoryLabel,
	} from "$lib/template-categories";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		icons: { group: string; icon: string; name: string }[];
		svc: { category: string | null; icon: string | null };
	}

	const { icons, svc }: Props = $props();

	let category = $derived(svc.category ?? "");
	let icon = $derived(svc.icon ?? "");
	let saving = $state(false);
</script>

<section class="panel rounded-md p-5">
  <div class="mb-4 flex items-center gap-3">
    <div class="bg-accent/10 text-accent flex size-8 shrink-0 items-center justify-center rounded-lg">
      <Palette class="size-4" />
    </div>
    <div>
      <p class="text-text text-sm font-medium">Type & icon</p>
      <p class="text-text-muted text-xs">
        What kind of app this is, and the icon it shows everywhere it's listed.
      </p>
    </div>
  </div>

  <form
    action="?/updateIdentity"
    class="space-y-4"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't save the type and icon.",
      loading: "Saving the type and icon",
      onSettled: () => {
        saving = false;
      },
      onStart: () => {
        saving = true;
      },
      success: "Saved.",
    })}
  >
    <input name="category" type="hidden" value={category}>
    <input name="icon" type="hidden" value={icon}>

    <div class="flex flex-wrap items-end gap-4">
      <TemplateIcon
        {category}
        class="size-14"
        fallback={Server}
        icon={icon || null}
      />
      <div class="w-60">
        <label class={label} for="serviceCategory">Type</label>
        <SelectRoot type="single" bind:value={category}>
          <SelectTrigger class="w-full" id="serviceCategory">
            {category ? templateCategoryLabel(category) : "None"}
          </SelectTrigger>
          <SelectContent>
            <SelectItem label="None" value="" />
            {#each TEMPLATE_CATEGORIES as option (option.value)}
              <SelectItem label={option.label} value={option.value} />
            {/each}
          </SelectContent>
        </SelectRoot>
      </div>
    </div>

    <IconPicker {icons} storedWith="service" bind:icon />

    <Button disabled={saving} type="submit" variant="outline">
      {#if saving}
        <Spinner />
      {:else}
        <Check class="size-4" />
      {/if}
      Save
    </Button>
  </form>
</section>
