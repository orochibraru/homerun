<script lang="ts">
	import {
		AlertTriangle,
		ArrowLeft,
		FileUp,
		HardDrive,
		Rocket,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import { inputClass, labelClass } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Checkbox } from "$lib/components/ui/checkbox/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Import a compose file"));

	const plan = $derived(form?.plan ?? null);

	let text = $state("");
	let parsing = $state(false);
	let importing = $state(false);
	let stackId = $state(untrack(() => data.stackId ?? ""));
	let stackName = $state("");
	let deploy = $state(false);
	let selected = $state<Record<string, boolean>>({});

	$effect(() => {
		const services = plan?.services ?? [];
		selected = Object.fromEntries(services.map((svc) => [svc.key, true]));
		stackName = services.length > 1 ? "Imported stack" : "";
	});

	const stackLabel = $derived(
		data.stacks.find((p) => p.id === stackId)?.name ?? "Create a new one",
	);
	const selectedCount = $derived(
		Object.values(selected).filter(Boolean).length,
	);
</script>

<div class="space-y-6 p-6 md:p-8">
  <a
    class="text-text-muted hover:text-text inline-flex items-center gap-1.5 text-sm"
    href={resolve("/services")}
  >
    <ArrowLeft class="size-3.5" />
    Services
  </a>

  <div>
    <h1 class="text-text text-lg font-semibold tracking-tight">
      Import a compose file
    </h1>
    <p class="text-text-muted mt-0.5 text-sm">
      Paste a Docker Compose file : every service becomes a Homerun service,
      every named volume or absolute bind mount becomes a storage volume.
    </p>
  </div>

  {#if form?.error}
    <Alert>
      {form.error}
    </Alert>
  {/if}

  <form
    action="?/preview"
    class="panel space-y-3 rounded-md p-5"
    method="POST"
    use:enhance={enhanceToast({
      error: "Couldn't parse that compose file.",
      loading: "Parsing the compose file",
      onSettled: () => {
        parsing = false;
      },
      onStart: () => {
        parsing = true;
      },
      success: "Parsed : review what gets created below.",
    })}
  >
    <label class={labelClass} for="compose">compose.yaml</label>
    <textarea
      class="{inputClass} h-64 resize-y text-xs"
      id="compose"
      name="compose"
      placeholder={"services:\n  web:\n    image: nginx:alpine\n    ports:\n      - \"8080:80\""}
      bind:value={text}
    ></textarea>
    <Button disabled={parsing} type="submit">
      {#if parsing}
        <Spinner />
      {:else}
        <FileUp class="size-4" />
      {/if}
      Parse
    </Button>
  </form>

  {#if plan}
    <form
      action="?/import"
      class="space-y-4"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't import that stack.",
        loading: "Importing the stack",
        onSettled: () => {
          importing = false;
        },
        onStart: () => {
          importing = true;
        },
        success: "Stack imported.",
      })}
    >
      <input name="compose" type="hidden" value={text} />

      {#if plan.warnings.length > 0}
        <div class="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
          <p class="flex items-center gap-1.5 font-medium">
            <AlertTriangle class="size-4" />
            Not everything maps onto Homerun
          </p>
          <ul class="mt-2 ml-4 list-disc space-y-1">
            {#each plan.warnings as warning (warning)}
              <li>{warning}</li>
            {/each}
          </ul>
        </div>
      {/if}

      {#if plan.missingEnvFiles.length > 0}
        <section class="panel space-y-4 rounded-md p-5">
          <div>
            <h2 class="eyebrow">Env files</h2>
            <p class="text-text-muted mt-0.5 text-xs">
              The file references these, relative to where it lived. Paste
              each one's contents to import its variables, or leave it blank
              to skip it.
            </p>
          </div>
          {#each plan.missingEnvFiles as path, index (path)}
            <div>
              <label class={labelClass} for="envFileContent-{index}">{path}</label>
              <input name="envFilePath" type="hidden" value={path} />
              <textarea
                class="{inputClass} h-28 resize-y font-mono text-xs"
                id="envFileContent-{index}"
                name="envFileContent"
                placeholder={"KEY=value"}
              ></textarea>
            </div>
          {/each}
        </section>
      {/if}

      <section class="panel rounded-md">
        <div class="border-border border-b px-5 py-4">
          <h2 class="eyebrow">Services ({plan.services.length})</h2>
        </div>
        <div class="divide-border divide-y">
          {#each plan.services as svc (svc.key)}
            <div class="flex items-start gap-3 px-5 py-4">
              <Checkbox
                checked={selected[svc.key] ?? false}
                name="serviceKey"
                onCheckedChange={(checked) => {
                  selected = { ...selected, [svc.key]: checked === true };
                }}
                value={svc.key}
              />
              <div class="min-w-0 flex-1">
                <p class="text-text text-sm font-medium">
                  {svc.name}
                  <span class="text-text-subtle text-xs">
                    ({svc.slug})
                  </span>
                </p>
                <p class="text-text-muted mt-0.5 text-xs">
                  {svc.image}:{svc.tag} · port {svc.containerPort}/{svc.portProtocol}
                  · {svc.networkMode}
                </p>
                {#if Object.keys(svc.envVars).length > 0}
                  <p class="text-text-subtle mt-1 text-xs">
                    {Object.keys(svc.envVars).length} environment variable{Object.keys(
                      svc.envVars,
                    ).length === 1
                      ? ""
                      : "s"}
                  </p>
                {/if}
                {#each svc.volumes as vol (vol.containerPath)}
                  <p class="text-text-subtle mt-1 flex items-center gap-1.5 text-xs">
                    <HardDrive class="size-3" />
                    {vol.source} → {vol.containerPath}{vol.readOnly ? " (ro)" : ""}
                  </p>
                {/each}
                {#each svc.warnings as warning (warning)}
                  <p class="mt-1 text-xs text-amber-600 dark:text-amber-400">
                    {warning}
                  </p>
                {/each}
              </div>
            </div>
          {/each}
        </div>
      </section>

      <section class="panel space-y-4 rounded-md p-5">
        <div>
          <label class={labelClass} for="stackId">Stack</label>
          <SelectRoot name="stackId" type="single" bind:value={stackId}>
            <SelectTrigger class="w-full" id="stackId">
              {stackLabel}
            </SelectTrigger>
            <SelectContent>
              <SelectItem label="Create a new one" value="" />
              {#each data.stacks as stack (stack.id)}
                <SelectItem label={stack.name} value={stack.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>

        {#if !stackId}
          <div>
            <label class={labelClass} for="stackName">
              New stack name (leave blank to import ungrouped)
            </label>
            <Input
              id="stackName"
              name="stackName"
              placeholder="Imported stack"
              type="text"
              bind:value={stackName}
            />
          </div>
        {/if}

        <label class="flex items-center gap-2 text-sm">
          <Checkbox name="deploy" bind:checked={deploy} />
          Deploy everything once imported (dependencies first)
        </label>
      </section>

      <Button disabled={importing || selectedCount === 0} type="submit">
        {#if importing}
          <Spinner />
        {:else}
          <Rocket class="size-4" />
        {/if}
        Import {selectedCount} service{selectedCount === 1 ? "" : "s"}
      </Button>
    </form>
  {/if}
</div>
