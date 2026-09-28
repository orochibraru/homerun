<script lang="ts">
	import { setMode } from "mode-watcher";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import SurfacePreview from "$lib/components/surface-preview.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { PER_PAGE_OPTIONS } from "$lib/list-sorts";
	import { PALETTES } from "$lib/palettes";
	import { title } from "$lib/store/title.js";
	import { DEFAULT_SURFACE, PRESETS, SURFACE_STYLES } from "$lib/surfaces";
	import { saveToast } from "$lib/toast";

	const { data } = $props();

	const DEFAULT_ACCENT = "#8b1e3f";
	const DEFAULT_CHARTS = [
		"#b8325a",
		"#c2418f",
		"#3b8fc4",
		"#2f9e6e",
		"#d99a2b",
	];

	// Seeded once from the initial load : untrack() is intentional, not a
	// lint workaround (same pattern as /settings' own $state seeds).
	let theme = $state(untrack(() => data.preferences.theme));
	let palette = $state(
		untrack(
			() =>
				data.preferences.palette ??
				(data.preferences.accentColor ? "custom" : ""),
		),
	);
	let perPage = $state(untrack(() => String(data.preferences.perPage)));
	let surfaceStyle = $state(untrack(() => data.preferences.surfaceStyle));
	let preset = $state<string>(untrack(() => data.preferences.preset ?? ""));

	const presetName = $derived(PRESETS.find((p) => p.id === preset)?.name);

	/** Shows the picked preset, or the picked style when there's none, on this page before it's saved. */
	function preview() {
		document.documentElement.dataset.surface = preset || surfaceStyle;
	}
	let accentColor = $state(
		untrack(() => data.preferences.accentColor ?? DEFAULT_ACCENT),
	);

	const choices = [
		{
			accent: DEFAULT_ACCENT,
			charts: DEFAULT_CHARTS,
			id: "",
			name: "Bordeaux",
		},
		...PALETTES,
	];

	const themeLabels: Record<typeof theme, string> = {
		dark: "Dark",
		light: "Light",
		system: "Match system",
	};

	onMount(() => title.set("Appearance"));
</script>

{#snippet overridden()}
    {#if presetName}
        <p class="text-accent mt-1 text-xs font-medium">
            The {presetName} preset overrides this while it's on. It's kept
            for when you pick None.
        </p>
    {/if}
{/snippet}

<div class="space-y-6">
    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Presets</h2>
            <p class="text-text-muted text-xs">
                A complete look from another era: its own theme, style and
                colors, overriding the ones below while it's on. Picking one
                previews it on this page; save to keep it.
            </p>
        </div>
        <form
            action="?/updatePreset"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Preset")}
        >
            <input name="preset" type="hidden" value={preset} />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                {#each [{ description: "Your own theme, style and colors below.", id: "", name: "None" }, ...PRESETS] as option (option.id)}
                    <button
                        aria-pressed={preset === option.id}
                        class="flex flex-col gap-3 rounded-md border p-3 text-left transition-colors {preset ===
                        option.id
                            ? 'border-accent bg-accent-light'
                            : 'border-border hover:bg-surface-2'}"
                        onclick={() => {
                            preset = option.id;
                            preview();
                        }}
                        type="button"
                    >
                        <SurfacePreview surface={option.id || surfaceStyle} />
                        <span>
                            <span class="text-text block text-sm font-medium">
                                {option.name}
                            </span>
                            <span class="text-text-muted block text-xs">
                                {option.description}
                            </span>
                        </span>
                    </button>
                {/each}
            </div>
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>

    <!-- ═══ Theme ═══ -->
    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Theme</h2>
            <p class="text-text-muted text-xs">
                "Match system" follows your OS's own light/dark setting and
                updates live if it changes.
            </p>
            {@render overridden()}
        </div>
        <form
            action="?/updateTheme"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Theme")}
        >
            <SelectRoot
                name="theme"
                type="single"
                bind:value={theme}
                onValueChange={(e) => setMode(theme)}
            >
                <SelectTrigger id="theme">
                    {themeLabels[theme]}
                </SelectTrigger>
                <SelectContent>
                    <SelectItem label="Match system" value="system" />
                    <SelectItem label="Light" value="light" />
                    <SelectItem label="Dark" value="dark" />
                </SelectContent>
            </SelectRoot>
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>

    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Style</h2>
            <p class="text-text-muted text-xs">
                How panels, cards and buttons are drawn. Picking one previews
                it on this page; save to keep it.
            </p>
            {@render overridden()}
        </div>
        <form
            action="?/updateSurface"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Style")}
        >
            <input name="surfaceStyle" type="hidden" value={surfaceStyle} />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-3">
                {#each SURFACE_STYLES as style (style.id)}
                    <button
                        aria-pressed={surfaceStyle === style.id}
                        class="flex flex-col gap-3 rounded-md border p-3 text-left transition-colors {surfaceStyle ===
                        style.id
                            ? 'border-accent bg-accent-light'
                            : 'border-border hover:bg-surface-2'}"
                        onclick={() => {
                            surfaceStyle = style.id;
                            preview();
                        }}
                        type="button"
                    >
                        <SurfacePreview surface={style.id} />
                        <span>
                            <span class="text-text block text-sm font-medium">
                                {style.name}{style.id === DEFAULT_SURFACE ? " (default)" : ""}
                            </span>
                            <span class="text-text-muted block text-xs">
                                {style.description}
                            </span>
                        </span>
                    </button>
                {/each}
            </div>
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>

    <!-- ═══ Colors ═══ -->
    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Colors</h2>
            <p class="text-text-muted text-xs">
                A palette sets the accent (buttons, links, tab icons) and the
                hues charts, category tiles and the background use, all
                picked to go together. Custom sets the accent alone.
            </p>
            {@render overridden()}
        </div>
        <form
            action="?/updateColors"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Colors")}
        >
            <input name="palette" type="hidden" value={palette} />
            <input name="accentColor" type="hidden" value={accentColor} />
            <div class="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-3">
                {#each choices as choice (choice.id)}
                    <button
                        class="flex flex-col gap-2 rounded-md border p-3 text-left transition-colors {palette ===
                        choice.id
                            ? 'border-accent bg-accent-light'
                            : 'border-border hover:bg-surface-2'}"
                        onclick={() => {
                            palette = choice.id;
                        }}
                        type="button"
                    >
                        <span class="text-text text-sm font-medium">
                            {choice.name}{choice.id === "" ? " (default)" : ""}
                        </span>
                        <span class="flex gap-1">
                            <span
                                class="size-5 rounded-full"
                                style="background-color: {choice.accent}"
                            ></span>
                            {#each choice.charts as hue, index (index)}
                                <span
                                    class="size-5 rounded-full opacity-80"
                                    style="background-color: {hue}"
                                ></span>
                            {/each}
                        </span>
                    </button>
                {/each}
                <label
                    class="flex cursor-pointer flex-col gap-2 rounded-md border p-3 transition-colors {palette ===
                    'custom'
                        ? 'border-accent bg-accent-light'
                        : 'border-border hover:bg-surface-2'}"
                >
                    <span class="text-text text-sm font-medium">Custom</span>
                    <input
                        aria-label="Custom accent color"
                        class="border-border h-5 w-16 cursor-pointer rounded border p-0"
                        oninput={() => {
                            palette = "custom";
                        }}
                        type="color"
                        bind:value={accentColor}
                    />
                </label>
            </div>
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>

    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Lists</h2>
            <p class="text-text-muted text-xs">
                How many rows every paginated list shows per page by default.
            </p>
        </div>
        <form
            action="?/updatePerPage"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Page size")}
        >
            <SelectRoot name="perPage" type="single" bind:value={perPage}>
                <SelectTrigger id="perPage">{perPage} per page</SelectTrigger>
                <SelectContent>
                    {#each PER_PAGE_OPTIONS as option (option)}
                        <SelectItem
                            label="{option} per page"
                            value={String(option)}
                        />
                    {/each}
                </SelectContent>
            </SelectRoot>
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>
</div>
