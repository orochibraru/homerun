<script lang="ts">
	import {
		Check,
		ChevronsUpDown,
		Download,
		FileCode2,
		FolderTree,
	} from "@lucide/svelte";
	import CodeBlock from "#lib/components/code-block.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { inputClass, labelClass } from "#lib/components/form-styles.js";
	import ObjectStoreSelect from "#lib/components/object-store-select.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import * as Command from "#lib/components/ui/command/index.js";
	import * as Popover from "#lib/components/ui/popover/index.js";
	import * as Select from "#lib/components/ui/select/index.js";
	import Spinner from "#lib/components/ui/spinner/spinner.svelte";
	import { matchBackend } from "#lib/iac/backend-match.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";

	const NEW_BACKEND = "new";

	const { data } = $props();

	let scope = $derived(data.scope);
	let scopeOpen = $state(false);
	let selectedPath = $state("");
	let creating = $state(false);

	const scopeOption = $derived(
		data.scopes.find((option) => option.value === scope),
	);
	const suggestedBackend = $derived(
		scopeOption
			? (matchBackend(scopeOption.name, data.projects) ??
					(data.stores.length > 0 ? NEW_BACKEND : ""))
			: "",
	);
	let projectId = $derived(
		data.scope && scope === data.scope ? data.projectId : suggestedBackend,
	);
	let newName = $derived(scopeOption?.name ?? "");
	let storeId = $derived(data.stores[0]?.id ?? "");
	let bucket = $derived(
		data.projects.find((project) => project.storeId === storeId)?.bucket ??
			"tfstate",
	);

	const projectLabel = $derived(
		projectId === NEW_BACKEND
			? "Create a new backend"
			: (data.projects.find((project) => project.id === projectId)?.name ??
					"No backend"),
	);
	const groups = $derived(
		["Stacks", "Services"]
			.map((group) => ({
				group,
				options: data.scopes.filter((option) => option.group === group),
			}))
			.filter((entry) => entry.options.length > 0),
	);
	const current = $derived(
		data.files?.find((file) => file.path === selectedPath) ??
			data.files?.find((file) => file.path.endsWith(".tf")) ??
			data.files?.[0] ??
			null,
	);
	const downloadHref = $derived(
		`${resolve("/(protected)/iac/download")}?${new URLSearchParams({
			...(data.projectId ? { project: data.projectId } : {}),
			scope: data.scope,
		})}`,
	);
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description="A Terraform project for one stack (its substacks included) or one service, with an import block for everything in it, so terraform plan adopts what already runs."
      icon={FileCode2}
      title="Generate a project"
    />
    <form
      id="iac-generate"
      class="grid gap-4 px-5 py-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
      method="GET"
    >
      <div>
        <label class={labelClass} for="iac-scope">Stack or service</label>
        <input name="scope" type="hidden" value={scope}>
        <Popover.Root bind:open={scopeOpen}>
          <Popover.Trigger>
            {#snippet child({ props })}
              <Button
                {...props}
                class="w-full justify-between"
                id="iac-scope"
                role="combobox"
                type="button"
                variant="outline"
              >
                <span class="truncate {scopeOption ? '' : 'text-text-muted'}">
                  {scopeOption?.label ?? "Pick a stack or a service…"}
                </span>
                <ChevronsUpDown class="size-4 shrink-0 opacity-50" />
              </Button>
            {/snippet}
          </Popover.Trigger>
          <Popover.Content class="w-(--bits-popover-anchor-width) p-0">
            <Command.Root>
              <Command.Input placeholder="Search stacks and services…" />
              <Command.List>
                <Command.Empty>No stack or service matches.</Command.Empty>
                {#each groups as entry (entry.group)}
                  <Command.Group heading={entry.group}>
                    {#each entry.options as option (option.value)}
                      <Command.Item
                        onSelect={() => {
                          scope = option.value;
                          scopeOpen = false;
                        }}
                        value="{option.label} {option.value}"
                      >
                        <Check
                          class="size-4 shrink-0 {scope === option.value ? '' : 'opacity-0'}"
                        />
                        <span class="truncate">{option.label}</span>
                      </Command.Item>
                    {/each}
                  </Command.Group>
                {/each}
              </Command.List>
            </Command.Root>
          </Popover.Content>
        </Popover.Root>
      </div>
      <div>
        <label class={labelClass} for="iac-project">State backend</label>
        <Select.Root
          name={projectId === NEW_BACKEND ? undefined : "project"}
          type="single"
          bind:value={projectId}
        >
          <Select.Trigger id="iac-project" class="w-full">{projectLabel}</Select.Trigger>
          <Select.Content>
            {#if data.stores.length > 0}
              <Select.Item label="Create a new backend" value={NEW_BACKEND} />
            {/if}
            <Select.Item label="No backend" value="" />
            {#each data.projects as project (project.id)}
              <Select.Item label={project.name} value={project.id} />
            {/each}
          </Select.Content>
        </Select.Root>
      </div>
      <Button
        disabled={!scope || creating}
        form={projectId === NEW_BACKEND ? "iac-new-backend" : "iac-generate"}
        type="submit"
      >
        {#if creating}
          <Spinner />
        {/if}
        Generate
      </Button>
    </form>
    {#if projectId === NEW_BACKEND}
      <form
        id="iac-new-backend"
        class="border-border grid gap-4 border-t px-5 py-4 sm:grid-cols-3"
        action="?/createBackend"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't create the backend.",
          loading: "Creating the backend",
          onSettled: () => {
            creating = false;
          },
          onStart: () => {
            creating = true;
          },
          onSuccess: async (result) => {
            if (typeof result?.projectId === "string") {
              await goto(
                `${resolve("iac/generate")}?${new URLSearchParams({
                  project: result.projectId,
                  scope,
                })}`,
              );
            }
          },
          success: "Backend created.",
        })}
      >
        <div>
          <label class={labelClass} for="iac-backend-name">Backend name</label>
          <input
            id="iac-backend-name"
            class={inputClass}
            autocomplete="off"
            name="name"
            required
            bind:value={newName}
          >
        </div>
        <div>
          <label class={labelClass} for="iac-backend-store">Store</label>
          <ObjectStoreSelect
            id="iac-backend-store"
            name="storeId"
            stores={data.stores}
            bind:value={storeId}
          />
        </div>
        <div>
          <label class={labelClass} for="iac-backend-bucket">Bucket</label>
          <input
            id="iac-backend-bucket"
            class={inputClass}
            autocomplete="off"
            name="bucket"
            required
            bind:value={bucket}
          >
        </div>
      </form>
    {/if}
    {#if data.stores.length === 0 && data.projects.length === 0}
      <p class="text-text-muted border-border border-t px-5 py-3 text-xs">
        No object store yet:
        <a class="text-accent hover:underline" href={resolve("/(protected)/object-storage/built-in")}>turn on the built-in one or connect one</a>
        to keep the Terraform state on this instance.
      </p>
    {/if}
  </section>

  {#if data.files && current}
    <section class="panel rounded-md">
      <PanelHeader
        description={`${data.files.length} files for ${data.name}. Unzip, export an API key (Overview → API key), then terraform init and plan.`}
        icon={FolderTree}
        title="Project"
      >
        {#snippet trailing()}
          <Button download href={downloadHref} size="sm">
            <Download class="size-3.5" />
            Download .zip
          </Button>
        {/snippet}
      </PanelHeader>
      <div class="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <ul class="flex flex-row flex-wrap gap-1 md:flex-col" aria-label="Files">
          {#each data.files as file (file.path)}
            <li>
              <button
                class="hover:bg-surface-2 w-full rounded-md px-2.5 py-1.5 text-left font-mono text-xs {file.path === current.path ? 'bg-surface-2 text-text font-bold' : 'text-text-muted'}"
                aria-current={file.path === current.path ? "true" : undefined}
                onclick={() => {
                  selectedPath = file.path;
                }}
                type="button"
              >
                {file.path}
              </button>
            </li>
          {/each}
        </ul>
        <CodeBlock code={current.content} html={current.html} label={current.path} />
      </div>
    </section>
  {:else if !data.scope}
    <EmptyState
      icon={FolderTree}
      subtitle="Pick a stack or a service above to generate its Terraform project."
      title="Nothing generated yet"
    />
  {/if}
</div>
