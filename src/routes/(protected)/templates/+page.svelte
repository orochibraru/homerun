<script lang="ts">
	import { LayoutGrid, Plus, Rocket, SettingsIcon } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import EntityList from "$lib/components/entity-list.svelte";
	import EntityToolbar, {
		type FilterGroup,
	} from "$lib/components/entity-toolbar.svelte";
	import Pagination from "$lib/components/pagination.svelte";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import ViewModeToggle from "$lib/components/view-mode-toggle.svelte";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import { ViewMode } from "$lib/view-mode.svelte";

	const { data } = $props();

	type Template = (typeof data.builtins)[number];

	onMount(() => title.set("Templates"));

	const view = new ViewMode("templates", "card");

	let quickDeploying = $state<string | null>(null);

	const CARD_GRID = "grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4";

	const filters = $derived<FilterGroup[]>([
		{
			key: "category",
			label: "Category",
			options: data.categories.map((c) => ({ label: c, value: c })),
		},
	]);

	const stackQuery = $derived(data.stack ? `?stackId=${data.stack.id}` : "");

	function detailsHref(tmpl: Template): string {
		return `${resolve("/(protected)/templates/[templateId]", {
			templateId: tmpl.id,
		})}${stackQuery}`;
	}

	function configureHref(tmpl: Template): string {
		return `${resolve("/services/new")}?templateId=${tmpl.id}${
			data.stack ? `&stackId=${data.stack.id}` : ""
		}`;
	}

	function quickDeployEnhance(tmpl: Template) {
		return enhanceToast({
			error: "Couldn't prepare deployment.",
			loading: `Preparing "${tmpl.name}" for deployment`,
			onSettled: () => {
				quickDeploying = null;
			},
			onStart: () => {
				quickDeploying = tmpl.id;
			},
			reset: false,
			success: `"${tmpl.name}" deploying`,
		});
	}

	function byId(id: string): Template | undefined {
		return [...data.builtins, ...data.mine].find((tmpl) => tmpl.id === id);
	}
</script>

{#snippet templateActions(tmpl: Template)}
  <form
    action="?/quickDeploy"
    class="flex-1"
    method="POST"
    use:enhance={quickDeployEnhance(tmpl)}
  >
    <input name="templateId" type="hidden" value={tmpl.id} />
    {#if data.stack}
      <input name="stackId" type="hidden" value={data.stack.id} />
    {/if}
    <Button
      class="w-full"
      disabled={quickDeploying !== null}
      size="sm"
      type="submit"
    >
      {#if quickDeploying === tmpl.id}
        <Spinner />
        Deploying…
      {:else}
        <Rocket class="size-3.5" />
        Quick Deploy
      {/if}
    </Button>
  </form>
  <Button href={configureHref(tmpl)} size="sm" variant="outline">
    <SettingsIcon class="size-3.5" />
    Configure
  </Button>
{/snippet}

{#snippet media(item: { id: string })}
  {@const tmpl = byId(item.id)}
  {#if tmpl}
    <TemplateIcon category={tmpl.category} icon={tmpl.icon} />
  {/if}
{/snippet}

{#snippet meta(item: { id: string })}
  {@const tmpl = byId(item.id)}
  {#if tmpl?.linkedNames && tmpl.linkedNames.length > 0}
    <span class="text-accent truncate text-xs">
      + {tmpl.linkedNames.join(", ")}
    </span>
  {/if}
  {#if tmpl?.tags && tmpl.tags.length > 0}
    <span class="text-text-subtle truncate font-mono text-[0.65rem]">
      {tmpl.tags.join(" · ")}
    </span>
  {/if}
{/snippet}

{#snippet actions(item: { id: string })}
  {@const tmpl = byId(item.id)}
  {#if tmpl}
    {@render templateActions(tmpl)}
  {/if}
{/snippet}

<div class="p-5 md:p-6">
  <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
    <div>
      <h1 class="text-text text-lg font-semibold tracking-tight">
        Templates
      </h1>
      <p class="text-text-muted mt-1 text-sm">
        One-click configs for common services.
      </p>
    </div>
    <Button href={resolve("/templates/new")} size="sm">
      <Plus class="size-4" />
      New Template
    </Button>
  </div>

  <EntityToolbar
    {filters}
    pageParams={["bpage", "mpage"]}
    placeholder="Search templates by name or image…"
  >
    {#snippet trailing()}
      <ViewModeToggle {view} />
    {/snippet}
  </EntityToolbar>

  <div class="mb-8">
    <h2 class="eyebrow mb-3">Built-in</h2>
    {#if data.builtins.length === 0}
      <p class="text-text-subtle text-sm">No built-in templates match.</p>
    {:else}
      <EntityList
        {actions}
        cardGridClass={CARD_GRID}
        items={data.builtins.map((tmpl) => ({
          description: tmpl.description,
          href: detailsHref(tmpl),
          id: tmpl.id,
          subtitle: `${tmpl.image}:${tmpl.tag}`,
          title: tmpl.name,
        }))}
        {media}
        {meta}
        {view}
      />
      <Pagination
        label="built-in templates"
        page={data.builtinsPage}
        pageParam="bpage"
        perPage={data.builtinsPerPage}
        total={data.builtinsTotal}
      />
    {/if}
  </div>

  <div>
    <h2 class="eyebrow mb-3">My Templates</h2>
    {#if data.mineTotal === 0 && !data.filtered}
      <div class="border-border flex flex-col items-center justify-center rounded-md border border-dashed py-12 text-center">
        <LayoutGrid class="text-text-muted mb-3 size-8 opacity-40" />
        <p class="text-text-muted text-sm font-medium">
          No custom templates yet
        </p>
        <p class="text-text-subtle mt-1 text-xs">
          Build one from scratch, or save an existing service as a template
          from its Settings tab.
        </p>
      </div>
    {:else if data.mine.length === 0}
      <p class="text-text-subtle text-sm">No custom templates match.</p>
    {:else}
      <EntityList
        {actions}
        cardGridClass={CARD_GRID}
        items={data.mine.map((tmpl) => ({
          description: tmpl.description,
          href: detailsHref(tmpl),
          id: tmpl.id,
          subtitle: `${tmpl.image}:${tmpl.tag}`,
          title: tmpl.name,
        }))}
        {media}
        {meta}
        {view}
      />
      <Pagination
        label="templates"
        page={data.minePage}
        pageParam="mpage"
        perPage={data.minePerPage}
        total={data.mineTotal}
      />
    {/if}
  </div>

  <p class="text-text-subtle mt-10 text-center text-xs">
    App icons by <a
      class="hover:text-text-muted underline"
      href="https://selfh.st/icons/"
      rel="noopener noreferrer"
      target="_blank">selfh.st/icons</a
    >, licensed under
    <a
      class="hover:text-text-muted underline"
      href="https://creativecommons.org/licenses/by/4.0/"
      rel="noopener noreferrer"
      target="_blank">CC BY 4.0</a
    >.
  </p>
</div>
