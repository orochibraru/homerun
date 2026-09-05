<script lang="ts">
	import { Link2 } from "@lucide/svelte";
	import { toast } from "svelte-sonner";
	import { labelClass } from "$lib/components/form-styles";
	import ResponsiveDialog from "$lib/components/responsive-dialog.svelte";
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
	} from "$lib/service-link";

	const {
		onImport,
		services,
	}: {
		onImport: (rows: ParsedEnvVar[]) => void;
		services: Array<LinkTargetService & { id: string }>;
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
		if (format === "jdbc" && !engine.supportsJdbc) {
			format = "url";
		}
	});

	const linkFormat = $derived(format as LinkFormat);
	const preview = $derived(
		target
			? buildLinkEnv({ format: linkFormat, prefix, target, urlKey })
			: ([] as ParsedEnvVar[]),
	);

	const formatOptions = $derived([
		["url", "Connection URL"],
		...(engine?.supportsJdbc ? [["jdbc", "JDBC URL"]] : []),
		["vars", "One variable per value"],
	] as Array<[LinkFormat, string]>);
	const formatLabel = $derived(
		formatOptions.find(([value]) => value === format)?.[1] ?? "Connection URL",
	);

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
      <div>
        <label class={labelClass} for="linkServiceId">Service</label>
        <SelectRoot type="single" bind:value={serviceId}>
          <SelectTrigger class="w-full" id="linkServiceId">
            {target ? target.name : "Pick a service…"}
          </SelectTrigger>
          <SelectContent>
            {#each services as svc (svc.id)}
              <SelectItem label="{svc.name} ({svc.image})" value={svc.id} />
            {/each}
          </SelectContent>
        </SelectRoot>
        {#if engine && target}
          <p class="text-text-subtle mt-1.5 text-xs">
            Detected {engine.label} · reachable at
            <span class="font-mono">{target.slug}:{target.containerPort}</span>
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
              class="font-mono"
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
              class="font-mono"
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
            <p class="text-text truncate font-mono text-xs">
              {row.key}={row.value}
            </p>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</ResponsiveDialog>
