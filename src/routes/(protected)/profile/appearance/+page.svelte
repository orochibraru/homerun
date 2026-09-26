<script lang="ts">
	import { setMode } from "mode-watcher";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
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

<div class="space-y-6">
    <!-- ═══ Theme ═══ -->
    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Theme</h2>
            <p class="text-text-muted text-xs">
                "Match system" follows your OS's own light/dark setting and
                updates live if it changes.
            </p>
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

    <!-- ═══ Colors ═══ -->
    <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Colors</h2>
            <p class="text-text-muted text-xs">
                A palette sets the accent (buttons, links, tab icons) and the
                hues charts, category tiles and the background use, all
                picked to go together. Custom sets the accent alone.
            </p>
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
