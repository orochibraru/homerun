<script lang="ts">
	import CheckBox from "$lib/components/check-box.svelte";
	import { inputClass, labelClass as label } from "$lib/components/form-styles";
	import { Input } from "$lib/components/ui/input/index.js";
	import type { StatusPageScope } from "$lib/types";

	interface StackOption {
		id: string;
		name: string;
	}

	interface ServiceOption {
		id: string;
		name: string;
		stackId: string | null;
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
		selectedServiceIds = $bindable([] as string[]),
	}: {
		stacks: StackOption[];
		services: ServiceOption[];
		errors?: Record<string, string[] | undefined> | null;
		name?: string;
		slug?: string;
		description?: string;
		scope?: StatusPageScope;
		stackId?: string;
		isPublic?: boolean;
		selectedServiceIds?: string[];
	} = $props();

	function toggleService(id: string) {
		selectedServiceIds = selectedServiceIds.includes(id)
			? selectedServiceIds.filter((sid) => sid !== id)
			: [...selectedServiceIds, id];
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
      <select bind:value={scope} class={inputClass} id="scope" name="scope">
        <option value="global">Every service</option>
        <option value="stack">One stack</option>
        <option value="custom">Services I pick</option>
      </select>
      <p class="text-text-subtle mt-1.5 text-xs">
        {scope === "custom"
          ? "Only the services ticked below."
          : "Resolved live, so a newly deployed service appears on its own."}
      </p>
    </div>
    {#if scope === "stack"}
      <div>
        <label class={label} for="stackId">Stack</label>
        <select
          bind:value={stackId}
          class={inputClass}
          id="stackId"
          name="stackId"
        >
          <option value="">Pick a stack…</option>
          {#each stacks as stack (stack.id)}
            <option value={stack.id}>{stack.name}</option>
          {/each}
        </select>
        {#if errors?.stackId}
          <p class="mt-1.5 text-xs text-red-500">{errors.stackId[0]}</p>
        {/if}
      </div>
    {/if}
  </div>

  {#if scope === "custom"}
    <div>
      <p class={label}>Services</p>
      {#if services.length === 0}
        <p class="text-text-subtle text-xs">No services to pick from yet.</p>
      {:else}
        <div class="border-border divide-border max-h-64 divide-y overflow-y-auto rounded-lg border">
          {#each services as svc (svc.id)}
            <label class="hover:bg-surface-2 flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input
                checked={selectedServiceIds.includes(svc.id)}
                class="accent-accent size-4"
                name="serviceIds"
                onchange={() => toggleService(svc.id)}
                type="checkbox"
                value={svc.id}
              />
              <span class="text-text">{svc.name}</span>
            </label>
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
