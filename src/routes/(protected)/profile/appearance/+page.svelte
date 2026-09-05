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
	import { title } from "$lib/store/title.js";
	import { saveToast } from "$lib/toast";

	const { data } = $props();

	const DEFAULT_ACCENT = "#0b8ac0";
	const PRESET_ACCENTS = [
		"#0b8ac0",
		"#22c55e",
		"#f97316",
		"#ef4444",
		"#a855f7",
		"#ec4899",
		"#eab308",
		"#14b8a6",
	];

	// Seeded once from the initial load : untrack() is intentional, not a
	// lint workaround (same pattern as /settings' own $state seeds).
	let theme = $state(untrack(() => data.preferences.theme));
	let sidebarColorIntensity = $state(
		untrack(() => data.preferences.sidebarColorIntensity),
	);
	let accentColor = $state(
		untrack(() => data.preferences.accentColor ?? DEFAULT_ACCENT),
	);
	// Tracked separately from `accentColor` (always a valid hex, for the
	// swatch/picker display) so "Reset to default" actually submits a blank
	// value, persisted as null : `accentColor` alone can't tell "picked the
	// same hex as the default" apart from "explicitly reset".
	let accentIsDefault = $state(
		untrack(() => data.preferences.accentColor === null),
	);

	const themeLabels: Record<typeof theme, string> = {
		dark: "Dark",
		light: "Light",
		system: "Match system",
	};
	const sidebarLabels: Record<typeof sidebarColorIntensity, string> = {
		accent: "Single accent color",
		colorful: "Colorful",
	};

	onMount(() => title.set("Appearance"));
</script>

<div class="space-y-6">
    <!-- ═══ Theme ═══ -->
    <section class="glass rounded-2xl">
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

    <!-- ═══ Sidebar color intensity ═══ -->
    <section class="glass rounded-2xl">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">
                Sidebar color intensity
            </h2>
            <p class="text-text-muted text-xs">
                "Colorful" gives each sidebar section its own color so they're
                easier to tell apart at a glance. "Single accent color" keeps
                every section the same, more muted, color instead.
            </p>
        </div>
        <form
            action="?/updateSidebar"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Sidebar color intensity")}
        >
            <SelectRoot
                name="sidebarColorIntensity"
                type="single"
                bind:value={sidebarColorIntensity}
            >
                <SelectTrigger id="sidebarColorIntensity">
                    {sidebarLabels[sidebarColorIntensity]}
                </SelectTrigger>
                <SelectContent>
                    <SelectItem label="Colorful" value="colorful" />
                    <SelectItem label="Single accent color" value="accent" />
                </SelectContent>
            </SelectRoot>
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>

    <!-- ═══ Main color accent ═══ -->
    <section class="glass rounded-2xl">
        <div class="border-border border-b px-5 py-4">
            <h2 class="eyebrow">Main color accent</h2>
            <p class="text-text-muted text-xs">
                Used for buttons, links, and highlighted state throughout the
                dashboard.
            </p>
        </div>
        <form
            action="?/updateAccent"
            class="space-y-4 p-5"
            method="POST"
            use:enhance={saveToast("Accent color")}
        >
            <div class="flex flex-wrap items-center gap-2.5">
                {#each PRESET_ACCENTS as preset (preset)}
                    <button
                        aria-label={preset}
                        class="size-8 rounded-full border-2 transition-transform hover:scale-110 {!accentIsDefault &&
                        accentColor.toLowerCase() === preset
                            ? 'border-text'
                            : 'border-transparent'}"
                        onclick={() => {
                            accentColor = preset;
                            accentIsDefault = false;
                        }}
                        style="background-color: {preset}"
                        type="button"
                    ></button>
                {/each}
                <input
                    aria-label="Custom color"
                    bind:value={accentColor}
                    class="border-border size-8 cursor-pointer rounded-lg border p-0.5"
                    oninput={() => {
                        accentIsDefault = false;
                    }}
                    type="color"
                />
                <Button
                    onclick={() => {
                        accentColor = DEFAULT_ACCENT;
                        accentIsDefault = true;
                    }}
                    type="button"
                    variant="ghost"
                >
                    Reset to default
                </Button>
            </div>
            <input
                name="accentColor"
                type="hidden"
                value={accentIsDefault ? "" : accentColor}
            />
            <div class="flex justify-end">
                <Button type="submit">Save</Button>
            </div>
        </form>
    </section>
</div>
