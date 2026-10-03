<script lang="ts">
	import { Upload, X } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import DashboardIconPicker from "#lib/components/dashboard-icon-picker.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import {
		ICON_UPLOAD_TYPES,
		iconSrc,
		MAX_ICON_BYTES,
	} from "#lib/service-icon.js";

	interface Props {
		icon: string;
		icons: { group: string; icon: string; name: string }[];
		storedWith: string;
	}

	let { icon = $bindable(), icons, storedWith }: Props = $props();

	let filter = $state("");
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
              <img alt="" class="size-full object-contain" src={iconSrc(entry.icon)}>
            </button>
          {/each}
        </div>
      </div>
    {:else}
      <p class="text-text-subtle text-xs">No icon matches.</p>
    {/each}
  </div>
</div>

<DashboardIconPicker
  onpick={(value) => {
    icon = value;
  }}
  selected={icon}
/>

<p class="text-text-subtle text-xs">
  Uploads up to {MAX_ICON_BYTES / 1024} KB, PNG, JPEG, WebP, GIF or SVG, stored
  with the {storedWith}.
</p>
