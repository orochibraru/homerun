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
	let projectId = $state(untrack(() => data.projectId ?? ""));
	let projectName = $state("");
	let deploy = $state(false);
	let selected = $state<Record<string, boolean>>({});

	$effect(() => {
		const services = plan?.services ?? [];
		selected = Object.fromEntries(services.map((svc) => [svc.key, true]));
		projectName = services.length > 1 ? "Imported stack" : "";
	});

	const projectLabel = $derived(
		data.projects.find((p) => p.id === projectId)?.name ?? "Create a new one",
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
    <h1 class="text-text text-xl font-semibold tracking-tight">
      Import a compose file
    </h1>
    <p class="text-text-muted mt-0.5 text-sm">
      Paste a Docker Compose file : every service becomes a Homerun service,
      every named volume or absolute bind mount becomes a storage volume.
    </p>
  </div>

  {#if form?.error}
    <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
      {form.error}
    </div>
  {/if}

  <form
    action="?/preview"
    class="glass space-y-3 rounded-2xl p-5"
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
      class="{inputClass} h-64 resize-y font-mono text-xs"
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
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
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

      <section class="glass rounded-2xl">
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
                  <span class="text-text-subtle font-mono text-xs">
                    ({svc.slug})
                  </span>
                </p>
                <p class="text-text-muted mt-0.5 font-mono text-xs">
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
                  <p class="text-text-subtle mt-1 flex items-center gap-1.5 font-mono text-xs">
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

      <section class="glass space-y-4 rounded-2xl p-5">
        <div>
          <label class={labelClass} for="projectId">Project</label>
          <SelectRoot name="projectId" type="single" bind:value={projectId}>
            <SelectTrigger class="w-full" id="projectId">
              {projectLabel}
            </SelectTrigger>
            <SelectContent>
              <SelectItem label="Create a new one" value="" />
              {#each data.projects as project (project.id)}
                <SelectItem label={project.name} value={project.id} />
              {/each}
            </SelectContent>
          </SelectRoot>
        </div>

        {#if !projectId}
          <div>
            <label class={labelClass} for="projectName">
              New project name (leave blank to import ungrouped)
            </label>
            <Input
              id="projectName"
              name="projectName"
              placeholder="Imported stack"
              type="text"
              bind:value={projectName}
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
