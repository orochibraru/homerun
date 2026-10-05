<script lang="ts">
	import { Check, ChevronsUpDown, X } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Checkbox } from "#lib/components/ui/checkbox/index.js";
	import * as Command from "#lib/components/ui/command/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import * as Popover from "#lib/components/ui/popover/index.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import type {
		StatusPagePick,
		StatusPageServiceOption,
	} from "#lib/status-page-members.js";
	import type { StatusPageScope } from "#lib/types.js";

	interface StackOption {
		id: string;
		name: string;
	}

	let {
		stacks,
		services,
		errors,
		name = $bindable(""),
		slug = $bindable(""),
		description = $bindable(""),
		scope = $bindable("global" as StatusPageScope),
		stackId = $bindable(""),
		isPublic = $bindable(false),
		picks = $bindable([] as StatusPagePick[]),
	}: {
		stacks: StackOption[];
		services: StatusPageServiceOption[];
		errors?: Record<string, string[] | undefined> | null;
		name?: string;
		slug?: string;
		description?: string;
		scope?: StatusPageScope;
		stackId?: string;
		isPublic?: boolean;
		picks?: StatusPagePick[];
	} = $props();

	const scopeOptions: { label: string; value: StatusPageScope }[] = [
		{ label: "Every service", value: "global" },
		{ label: "One stack", value: "stack" },
		{ label: "Services I pick", value: "custom" },
	];

	let pickerOpen = $state(false);

	const stackNames = $derived(
		new Map(stacks.map((stack) => [stack.id, stack.name])),
	);
	const servicesById = $derived(new Map(services.map((svc) => [svc.id, svc])));
	const pickable = $derived(services.filter((svc) => svc.pickable));
	const pickedIds = $derived(new Set(picks.map((pick) => pick.serviceId)));

	function stackLabel(svc: StatusPageServiceOption): string {
		return svc.stackId
			? (stackNames.get(svc.stackId) ?? "Unknown stack")
			: "No stack";
	}

	function toggleService(id: string) {
		picks = pickedIds.has(id)
			? picks.filter((pick) => pick.serviceId !== id)
			: [...picks, { includeChildren: false, serviceId: id }];
	}

	function setIncludeChildren(id: string, includeChildren: boolean) {
		picks = picks.map((pick) =>
			pick.serviceId === id ? { ...pick, includeChildren } : pick,
		);
	}
</script>

<div class="space-y-4">
  <div class="grid gap-4 md:grid-cols-2">
    <div>
      <label class={label} for="name">
        Name <span class="text-red-500">*</span>
      </label>
      <Input bind:value={name} id="name" name="name" placeholder="Production" />
      {#if errors?.name}
        <p class="mt-1.5 text-xs text-red-500">{errors.name[0]}</p>
      {/if}
    </div>
    <div>
      <label class={label} for="slug">
        URL slug <span class="text-red-500">*</span>
      </label>
      <Input bind:value={slug} id="slug" name="slug" placeholder="production" />
      <p class="text-text-subtle mt-1.5 text-xs">
        The public page lives at <code class="font-mono">/status/{slug || "…"}</code>.
      </p>
      {#if errors?.slug}
        <p class="mt-1.5 text-xs text-red-500">{errors.slug[0]}</p>
      {/if}
    </div>
  </div>

  <div>
    <label class={label} for="description">Description</label>
    <Input
      bind:value={description}
      id="description"
      name="description"
      placeholder="What visitors should understand about this page."
    />
  </div>

  <div class="grid gap-4 md:grid-cols-2">
    <div>
      <label class={label} for="scope">Covers</label>
      <Select.Root name="scope" type="single" bind:value={scope}>
        <Select.Trigger class="w-full" id="scope">
          {scopeOptions.find((option) => option.value === scope)?.label}
        </Select.Trigger>
        <Select.Content>
          {#each scopeOptions as option (option.value)}
            <Select.Item label={option.label} value={option.value} />
          {/each}
        </Select.Content>
      </Select.Root>
      <p class="text-text-subtle mt-1.5 text-xs">
        {scope === "custom"
          ? "Only the services picked below."
          : "Resolved live, so a newly deployed service appears on its own."}
      </p>
    </div>
    {#if scope === "stack"}
      <div>
        <label class={label} for="stackId">Stack</label>
        <Select.Root name="stackId" type="single" bind:value={stackId}>
          <Select.Trigger class="w-full" id="stackId">
            {stacks.find((stack) => stack.id === stackId)?.name ??
              "Pick a stack…"}
          </Select.Trigger>
          <Select.Content>
            {#each stacks as stack (stack.id)}
              <Select.Item label={stack.name} value={stack.id} />
            {/each}
          </Select.Content>
        </Select.Root>
        {#if errors?.stackId}
          <p class="mt-1.5 text-xs text-red-500">{errors.stackId[0]}</p>
        {/if}
      </div>
    {/if}
  </div>

  {#if scope === "custom"}
    <div>
      <label class={label} for="servicePicker">Services</label>
      {#each picks as pick (pick.serviceId)}
        <input name="serviceIds" type="hidden" value={pick.serviceId}>
        {#if pick.includeChildren}
          <input name="includeChildren" type="hidden" value={pick.serviceId}>
        {/if}
      {/each}
      <Popover.Root bind:open={pickerOpen}>
        <Popover.Trigger>
          {#snippet child({ props })}
            <Button
              {...props}
              class="w-full justify-between"
              disabled={pickable.length === 0}
              id="servicePicker"
              role="combobox"
              type="button"
              variant="outline"
            >
              <span class="text-text-muted truncate">
                {pickable.length === 0
                  ? "No services to pick from yet."
                  : picks.length === 0
                    ? "Pick services…"
                    : `${picks.length} picked, add or remove…`}
              </span>
              <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
            </Button>
          {/snippet}
        </Popover.Trigger>
        <Popover.Content class="w-(--bits-popover-anchor-width) p-0">
          <Command.Root>
            <Command.Input placeholder="Search services…" />
            <Command.List>
              <Command.Empty>No service matches.</Command.Empty>
              <Command.Group>
                {#each pickable as svc (svc.id)}
                  <Command.Item
                    keywords={[stackLabel(svc)]}
                    onSelect={() => toggleService(svc.id)}
                    value="{svc.name} {svc.id}"
                  >
                    <Check
                      class="size-4 shrink-0 {pickedIds.has(svc.id) ? '' : 'opacity-0'}"
                    />
                    <span class="flex min-w-0 flex-col">
                      <span class="truncate">{svc.name}</span>
                      <span class="text-text-subtle truncate text-[0.6875rem]">
                        {stackLabel(svc)}
                      </span>
                    </span>
                  </Command.Item>
                {/each}
              </Command.Group>
            </Command.List>
          </Command.Root>
        </Popover.Content>
      </Popover.Root>

      {#if picks.length > 0}
        <div class="border-border divide-border mt-2 divide-y rounded-lg border">
          {#each picks as pick (pick.serviceId)}
            {@const svc = servicesById.get(pick.serviceId)}
            <div class="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2 text-sm">
              <span class="flex min-w-0 flex-1 flex-col">
                <span class="text-text truncate">{svc?.name ?? pick.serviceId}</span>
                {#if svc}
                  <span class="text-text-subtle truncate text-[0.6875rem]">
                    {stackLabel(svc)}
                  </span>
                {/if}
              </span>
              {#if svc?.hasChildren}
                <label class="text-text-muted flex items-center gap-2 text-xs">
                  <Checkbox
                    checked={pick.includeChildren}
                    onCheckedChange={(on) => setIncludeChildren(pick.serviceId, on)}
                  />
                  Include previews and canary
                </label>
              {/if}
              <Button
                aria-label="Remove {svc?.name ?? 'service'}"
                onclick={() => toggleService(pick.serviceId)}
                size="icon-sm"
                type="button"
                variant="ghost"
              >
                <X class="size-4" />
              </Button>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}

  <CheckBox
    bind:checked={isPublic}
    helperText="Anyone with the link can see it, without signing in. It shows service names, up/down and uptime percentages only : never images, ports, hostnames or probe errors."
    id="isPublic"
    label="Publish this page"
    name="isPublic"
  />
</div>
