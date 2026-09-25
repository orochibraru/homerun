<script lang="ts">
	import { Link2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { labelClass } from "$lib/components/form-styles";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
	import ServicePicker, {
		type PickableService,
	} from "$lib/components/service-picker.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import type { ParsedEnvVar } from "$lib/env-parse";
	import {
		buildLinkEnv,
		defaultUrlKey,
		defaultVarPrefix,
		detectLinkEngine,
		type LinkFormat,
		type LinkTargetService,
		linkFormatsFor,
	} from "$lib/service-link";

	const {
		onImport,
		services,
		stackId,
		stacks,
	}: {
		onImport: (rows: ParsedEnvVar[]) => void;
		services: Array<LinkTargetService & PickableService>;
		stackId: string | null;
		stacks: { id: string; name: string }[];
	} = $props();

	let open = $state(false);
	let serviceId = $state("");
	let format = $state<string>("url");
	let urlKey = $state("");
	let prefix = $state("");

	const target = $derived(services.find((svc) => svc.id === serviceId) ?? null);
	const engine = $derived(target ? detectLinkEngine(target.image) : null);

	$effect(() => {
		if (!(target && engine)) {
			return;
		}
		urlKey = defaultUrlKey(engine, target);
		prefix = defaultVarPrefix(engine, target);
		if (!linkFormatsFor(engine).some(([value]) => value === format)) {
			format = "url";
		}
	});

	const linkFormat = $derived(format as LinkFormat);
	const preview = $derived(
		target
			? buildLinkEnv({ format: linkFormat, prefix, target, urlKey })
			: ([] as ParsedEnvVar[]),
	);

	const formatOptions = $derived(linkFormatsFor(engine));
	const formatLabel = $derived(
		formatOptions.find(([value]) => value === format)?.[1] ?? "Connection URL",
	);

	/**
	 * Hands the previewed link variables to the parent form and closes the dialog,
	 * refusing when no service is picked or a variable name is blank. Nothing is
	 * saved server-side until the parent form is submitted.
	 */
	function apply() {
		if (!target) {
			toast.error("Pick a service to link to.");
			return;
		}
		if (preview.some((row) => !row.key.trim())) {
			toast.error("Give every variable a name.");
			return;
		}
		onImport(preview);
		toast.success(
			`Linked ${target.name} : ${preview.length} variable${
				preview.length === 1 ? "" : "s"
			} added.`,
		);
		open = false;
	}
</script>

<Button class="mt-1 h-auto p-0" onclick={() => (open = true)} variant="link">
  <Link2 class="size-3.5" />
  Link a service
</Button>

<ResponsiveDialog
  bind:open
  description="Point this service at another one on this host. Homerun fills in the internal hostname, port and credentials it already knows about."
  onsubmit={apply}
  size="md"
  submitDisabled={!target}
  submitLabel="Add variables"
  title="Link a service"
>
  {#if services.length === 0}
    <p class="text-text-muted text-sm">
      No other services to link to yet.
    </p>
  {:else}
    <div class="space-y-4">
      <div class="space-y-4">
        <ServicePicker
          id="linkService"
          {services}
          {stackId}
          {stacks}
          bind:value={serviceId}
        />
        {#if engine && target}
          <p class="text-text-subtle mt-1.5 text-xs">
            Detected {engine.label} · reachable at
            <span class="">{target.slug}:{target.containerPort}</span>
          </p>
        {/if}
      </div>

      {#if target}
        <div>
          <label class={labelClass} for="linkFormat">Format</label>
          <SelectRoot type="single" bind:value={format}>
            <SelectTrigger class="w-full" id="linkFormat">
              {formatLabel}
            </SelectTrigger>
            <SelectContent>
              {#each formatOptions as [value, optionLabel] (value)}
                <SelectItem label={optionLabel} value={value} />
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>

        {#if linkFormat === "vars"}
          <div>
            <label class={labelClass} for="linkPrefix">Variable prefix</label>
            <Input
              class=""
              id="linkPrefix"
              placeholder="POSTGRES"
              type="text"
              bind:value={prefix}
            />
          </div>
        {:else}
          <div>
            <label class={labelClass} for="linkUrlKey">Variable name</label>
            <Input
              class=""
              id="linkUrlKey"
              placeholder="DATABASE_URL"
              type="text"
              bind:value={urlKey}
            />
          </div>
        {/if}

        <div class="bg-surface-2 border-border rounded-lg border p-3">
          <p class={labelClass}>Preview</p>
          {#each preview as row (row.key)}
            <p class="text-text truncate text-xs">
              {row.key}={row.value}
            </p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</ResponsiveDialog>
