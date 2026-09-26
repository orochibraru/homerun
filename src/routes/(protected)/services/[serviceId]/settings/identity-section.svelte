<script lang="ts">
	import { Check, Palette, Server, Upload, X } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { ICON_UPLOAD_TYPES, MAX_ICON_BYTES } from "$lib/service-icon";
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
	let filter = $state("");
	let saving = $state(false);
	let fileInput = $state<HTMLInputElement | null>(null);

	const shown = $derived(
		icons.filter((entry) =>
			entry.name.toLowerCase().includes(filter.trim().toLowerCase()),
		),
	);
	const groups = $derived(
		[...new Set(shown.map((entry) => entry.group))].map((group) => ({
			entries: shown.filter((entry) => entry.group === group),
			group,
		})),
	);

	function readUpload(file: File): void {
		if (!ICON_UPLOAD_TYPES.includes(file.type)) {
			toast.error("Upload a PNG, JPEG, WebP, GIF or SVG image.");
			return;
		}
		if (file.size > MAX_ICON_BYTES) {
			toast.error(
				`The icon is over ${MAX_ICON_BYTES / 1024} KB : use a smaller image.`,
			);
			return;
		}
		const reader = new FileReader();
		reader.addEventListener("load", () => {
			icon = String(reader.result);
		});
		reader.readAsDataURL(file);
	}
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
      <div class="flex gap-2">
        <input
          class="hidden"
          accept={ICON_UPLOAD_TYPES.join(",")}
          onchange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              readUpload(file);
            }
            event.currentTarget.value = "";
          }}
          type="file"
          bind:this={fileInput}
        >
        <Button onclick={() => fileInput?.click()} type="button" variant="outline">
          <Upload class="size-4" />
          Upload
        </Button>
        {#if icon}
          <Button
            onclick={() => {
              icon = "";
            }}
            type="button"
            variant="ghost"
          >
            <X class="size-4" />
            No icon
          </Button>
        {/if}
      </div>
    </div>

    <div>
      <div class="mb-2 flex items-center justify-between gap-3">
        <span class={label}>Icon library</span>
        <Input
          class="max-w-56"
          aria-label="Filter icons"
          placeholder="Filter by app…"
          type="search"
          bind:value={filter}
        />
      </div>
      <div class="max-h-80 space-y-3 overflow-y-auto">
        {#each groups as { entries, group } (group)}
          <div>
            <p class="text-text-subtle mb-1.5 text-[0.6875rem] font-medium">
              {group}
            </p>
            <div class="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-2">
              {#each entries as entry (entry.icon)}
                <button
                  class="
                    flex aspect-square items-center justify-center rounded-md border p-2 transition-colors {icon ===
                    entry.icon
                    ? 'border-accent bg-accent-light'
                    : 'border-border hover:bg-surface-2'}
                  "
                  aria-label={entry.name}
                  onclick={() => {
                    icon = entry.icon;
                  }}
                  title={entry.name}
                  type="button"
                >
                  <img
                    alt=""
                    class="size-full object-contain"
                    src="/template-icons/{entry.icon}"
                  >
                </button>
              {/each}
            </div>
          </div>
        {:else}
          <p class="text-text-subtle text-xs">No icon matches.</p>
        {/each}
      </div>
    </div>

    <p class="text-text-subtle text-xs">
      Uploads up to {MAX_ICON_BYTES / 1024} KB, PNG, JPEG, WebP, GIF or SVG,
      stored with the service.
    </p>

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
