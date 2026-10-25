<script lang="ts">
	import { Building2, House, Monitor, Moon, Sun } from "@lucide/svelte";
	import { setMode } from "mode-watcher";
	import type { Component } from "svelte";
	import { handleSwitchMode } from "#lib/account-actions.js";
	import { enhanceToast } from "#lib/toast.js";
	import { UI_MODE_LABELS, type UiMode } from "#lib/ui-mode.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

	type Theme = "dark" | "light" | "system";

	interface Choice<T extends string> {
		icon: Component;
		label: string;
		value: T;
	}

	const {
		theme,
		uiMode,
		user,
	}: {
		theme: Theme;
		uiMode: UiMode;
		user: {
			email?: string | null;
			image?: string | null;
			name?: string | null;
		};
	} = $props();

	let picked = $state<Theme | null>(null);
	const currentTheme = $derived(picked ?? theme);

	const themes: Choice<Theme>[] = [
		{ icon: Sun, label: "Light", value: "light" },
		{ icon: Moon, label: "Dark", value: "dark" },
		{ icon: Monitor, label: "System", value: "system" },
	];

	const modes: Choice<UiMode>[] = [
		{ icon: House, label: UI_MODE_LABELS.simple, value: "simple" },
		{ icon: Building2, label: UI_MODE_LABELS.advanced, value: "advanced" },
	];

	function segmentClass(active: boolean): string {
		return `flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50 ${
			active ? "bg-ink text-ink-foreground shadow-sm" : "text-text-muted"
		}`;
	}
</script>

<div class="mb-5 flex flex-col gap-4 md:hidden" data-slot="mobile-account">
  <div class="border-border bg-surface flex items-center gap-3.5 rounded-2xl border p-3.5">
    {#if user.image}
      <img alt={user.name ?? ""} class="ring-border size-12 rounded-full object-cover ring-1" src={user.image} />
    {:else}
      <span class="bg-accent text-bg flex size-12 items-center justify-center rounded-full text-lg font-semibold">
        {user.name?.[0]?.toUpperCase() ?? "?"}
      </span>
    {/if}
    <div class="min-w-0">
      <p class="text-text truncate font-semibold">{user.name}</p>
      <p class="text-text-muted truncate text-sm">{user.email}</p>
    </div>
  </div>

  <section>
    <h2 class="text-text-subtle mb-2 px-1 text-xs font-medium">Interface</h2>
    <div class="bg-surface-2 flex gap-1 rounded-2xl p-1">
      {#each modes as mode (mode.value)}
        {@const Icon = mode.icon}
        <button
          class={segmentClass(uiMode === mode.value)}
          aria-pressed={uiMode === mode.value}
          onclick={() => uiMode !== mode.value && handleSwitchMode(mode.value)}
          type="button"
        >
          <Icon class="size-4" />
          {mode.label}
        </button>
      {/each}
    </div>
  </section>

  <section>
    <h2 class="text-text-subtle mb-2 px-1 text-xs font-medium">Theme</h2>
    <form
      class="bg-surface-2 flex gap-1 rounded-2xl p-1"
      action="{resolve('profile/appearance')}?/updateTheme"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the theme.",
        loading: "Saving the theme",
        onSubmit: ({ formData }) => {
          const value = formData.get("theme") as Theme;
          picked = value;
          setMode(value);
        },
        success: "Theme saved.",
      })}
    >
      {#each themes as option (option.value)}
        {@const Icon = option.icon}
        <button
          class={segmentClass(currentTheme === option.value)}
          aria-pressed={currentTheme === option.value}
          name="theme"
          type="submit"
          value={option.value}
        >
          <Icon class="size-4" />
          {option.label}
        </button>
      {/each}
    </form>
  </section>
</div>
