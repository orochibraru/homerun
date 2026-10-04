<script lang="ts">
	import { Palette, Server } from "@lucide/svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import IconPicker from "#lib/components/icon-picker.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import TemplateIcon from "#lib/components/template-icon.svelte";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "#lib/components/ui/select/index.js";
	import {
		TEMPLATE_CATEGORIES,
		templateCategoryLabel,
	} from "#lib/template-categories.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	interface Props {
		icons: { group: string; icon: string; name: string }[];
		svc: { category: string | null; icon: string | null };
	}

	const { icons, svc }: Props = $props();

	let category = $derived(svc.category ?? "");
	let icon = $derived(svc.icon ?? "");
	let saving = $state(false);
</script>

<section class="panel rounded-md">
  <PanelHeader
    description="What kind of app this is, and the icon it shows everywhere it's listed."
    icon={Palette}
    title="Type & icon"
  >
    {#snippet trailing()}
      <SaveButton form="service-identity" pending={saving} />
    {/snippet}
  </PanelHeader>

  <form
    id="service-identity"
    action="?/updateIdentity"
    class="space-y-4 p-5"
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
  </form>
</section>
