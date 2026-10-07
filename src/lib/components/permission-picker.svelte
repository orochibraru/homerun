<script lang="ts">
	import { Button } from "#lib/components/ui/button/index.js";
	import {
		allPermissions,
		can,
		intersectPermissions,
		PERMISSION_AREAS,
		type PermissionArea,
		type PermissionLevel,
		type Permissions,
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

	function selectable(area: PermissionArea, level: PermissionLevel | "none") {
		return level === "none" || can(grantable, area, level);
	}
</script>

{#each areas as area (area.key)}
  <input name="permission.{area.key}" type="hidden" value={value[area.key] ?? "none"}>
{/each}

<div class="space-y-2">
  <div class="flex items-center justify-end gap-1">
    <Button
      {disabled}
      onclick={() => {
        value = intersectPermissions(allPermissions("read"), grantable);
      }}
      size="sm"
      type="button"
      variant="ghost"
    >
      Read everything
    </Button>
    <Button
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
              class="h-auto px-2.5 py-1 text-xs {current === option.level
                ? 'bg-surface-2'
                : ''}"
              disabled={disabled || !selectable(area.key, option.level)}
              onclick={() => select(area.key, option.level)}
              role="radio"
              size="sm"
              type="button"
              variant="ghost"
            >
              {option.label}
            </Button>
          {/each}
        </div>
      </div>
    {/each}
  </div>
</div>
