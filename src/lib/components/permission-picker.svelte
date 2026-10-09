<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import {
		allPermissions,
		can,
		intersectPermissions,
		PERMISSION_AREAS,
		PERMISSION_PRESETS,
		type PermissionArea,
		type PermissionLevel,
		type Permissions,
		samePermissions,
	} from "#lib/permissions.js";

	interface Props {
		disabled?: boolean;
		grantable?: Permissions;
		value: Permissions;
	}

	let {
		disabled = false,
		grantable = allPermissions("write"),
		value = $bindable(),
	}: Props = $props();

	const LEVELS: { label: string; level: PermissionLevel | "none" }[] = [
		{ label: "None", level: "none" },
		{ label: "Read", level: "read" },
		{ label: "Write", level: "write" },
	];

	const areas = $derived(
		PERMISSION_AREAS.filter((area) => can(grantable, area.key)),
	);

	function select(area: PermissionArea, level: PermissionLevel | "none") {
		const next = { ...value };
		if (level === "none") {
			delete next[area];
		} else {
			next[area] = level;
		}
		value = next;
	}

	const presets = $derived(
		PERMISSION_PRESETS.map((preset) => ({
			...preset,
			permissions: intersectPermissions(preset.permissions, grantable),
		})).filter((preset) => Object.keys(preset.permissions).length > 0),
	);

	function selectable(area: PermissionArea, level: PermissionLevel | "none") {
		return level === "none" || can(grantable, area, level);
	}
</script>

{#each areas as area (area.key)}
  <input name="permission.{area.key}" type="hidden" value={value[area.key] ?? "none"}>
{/each}

<div class="space-y-2">
  <div class="flex flex-wrap items-center gap-2">
    <span class="text-xs text-text-muted">Presets</span>
    {#each presets as preset (preset.id)}
      {@const active = samePermissions(value, preset.permissions)}
      <Button
        aria-pressed={active}
        {disabled}
        onclick={() => {
          value = { ...preset.permissions };
        }}
        size="sm"
        title={preset.description}
        type="button"
        variant={active ? "default" : "outline"}
      >
        {preset.label}
      </Button>
    {/each}
    <Button
      class="ml-auto"
      {disabled}
      onclick={() => {
        value = {};
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      Clear
    </Button>
  </div>
  <div class="divide-y divide-border rounded-md border border-border">
    {#each areas as area (area.key)}
      {@const current = value[area.key] ?? "none"}
      <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-text">{area.label}</p>
          <p class="text-xs text-text-muted">{area.description}</p>
        </div>
        <div
          aria-label="{area.label} access"
          class="panel inline-flex shrink-0 rounded-lg p-0.5"
          role="radiogroup"
        >
          {#each LEVELS as option (option.level)}
            <Button
              aria-checked={current === option.level}
              class="h-auto px-2.5 py-1 text-xs"
              disabled={disabled || !selectable(area.key, option.level)}
              onclick={() => select(area.key, option.level)}
              role="radio"
              size="sm"
              type="button"
              variant={current !== option.level
                ? "ghost"
                : option.level === "none"
                  ? "secondary"
                  : "default"}
            >
              {option.label}
            </Button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
