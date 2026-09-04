<script lang="ts">
	import {
		LayoutGrid,
		ListFilter,
		Plus,
		Rocket,
		Search,
		SettingsIcon,
		X,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { goto } from "$app/navigation";
	import { resolve } from "$app/paths";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button";
	import {
		Drawer,
		DrawerContent,
		DrawerHeader,
		DrawerTitle,
	} from "$lib/components/ui/drawer";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();

	let search = $state("");
	let selectedCategories = $state<string[]>([]);
	let filtersOpen = $state(false);
	let quickDeploying = $state<string | null>(null);

	onMount(() => title.set("Templates"));

	const categories = $derived(
		[
			...new Set(
				[...data.builtins, ...data.mine]
					.map((t) => t.category)
					.filter((c): c is string => !!c),
			),
		].sort(),
	);

	function toggleCategory(c: string) {
		selectedCategories = selectedCategories.includes(c)
			? selectedCategories.filter((x) => x !== c)
			: [...selectedCategories, c];
	}

	function matches(tmpl: (typeof data.builtins)[number]): boolean {
		if (
			selectedCategories.length > 0 &&
			!(tmpl.category && selectedCategories.includes(tmpl.category))
		) {
			return false;
		}
		if (!search.trim()) {
			return true;
		}
		const q = search.trim().toLowerCase();
		return (
			tmpl.name.toLowerCase().includes(q) ||
			(tmpl.description?.toLowerCase().includes(q) ?? false) ||
			tmpl.image.toLowerCase().includes(q)
		);
	}

	const filteredBuiltins = $derived(data.builtins.filter(matches));
	const filteredMine = $derived(data.mine.filter(matches));
</script>

{#snippet card(tmpl: (typeof data.builtins)[number])}
    <div
        class="rounded-2xl border flex flex-col justify-between gap-2 h-full border-border bg-surface p-5 transition-shadow hover:shadow-md"
    >
        <a
            class="flex flex-col gap-2"
            href="{resolve('/(protected)/templates/[templateId]', {
                templateId: tmpl.id,
            })}{data.project ? `?projectId=${data.project.id}` : ''}"
        >
            <TemplateIcon category={tmpl.category} icon={tmpl.icon} />
            <p class="font-semibold text-text">{tmpl.name}</p>
            {#if tmpl.description}
                <p class="line-clamp-2 text-xs text-text-muted">
                    {tmpl.description}
                </p>
            {/if}
            <p class="font-mono text-xs text-text-subtle">
                {tmpl.image}:{tmpl.tag}
            </p>
            {#if tmpl.linkedNames && tmpl.linkedNames.length > 0}
                <p class="text-xs text-accent">
                    + {tmpl.linkedNames.join(", ")}
                </p>
            {/if}
        </a>
        <div class="flex gap-2">
            <form
                action="?/quickDeploy"
                class="flex-1"
                method="POST"
                use:enhance={() => {
                    quickDeploying = tmpl.id;
                    return async ({ result, update }) => {
                        quickDeploying = null;
                        if (result.type === "success") {
                            const href = (
                                result.data as { href?: string } | undefined
                            )?.href;
                            toast.success(`"${tmpl.name}" deployed.`, {
                                action: href
                                    ? {
                                          label: "View",
                                          onClick: () => goto(href),
                                      }
                                    : undefined,
                            });
                        } else if (result.type === "failure") {
                            toast.error(
                                (result.data as { error?: string } | undefined)
                                    ?.error ?? "Couldn't deploy.",
                            );
                        } else if (result.type === "error") {
                            toast.error(
                                result.error?.message ??
                                    "Something went wrong.",
                            );
                        }
                        await update({ reset: false });
                    };
                }}
            >
                <input name="templateId" type="hidden" value={tmpl.id} />
                {#if data.project}
                    <input
                        name="projectId"
                        type="hidden"
                        value={data.project.id}
                    />
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
            <Button
                href="{resolve(
                    '/services/new',
                )}?templateId={tmpl.id}{data.project
                    ? `&projectId=${data.project.id}`
                    : ''}"
                size="sm"
                variant="outline"
            >
                <SettingsIcon class="size-3.5" />
                Configure
            </Button>
        </div>
    </div>
{/snippet}

<div class="p-6 md:p-8">
    <div class="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
            <h1 class="text-2xl font-bold text-text">Templates</h1>
            <p class="mt-1 text-sm text-text-muted">
                One-click configs for common services.
            </p>
        </div>
        <Button href={resolve("/templates/new")} size="sm">
            <Plus class="size-4" />
            New Template
        </Button>
    </div>

    <div class="mb-8 flex flex-wrap items-center gap-3">
        <div class="relative flex-1 min-w-52">
            <Search
                class="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-subtle"
            />
            <input
                bind:value={search}
                class="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text placeholder:text-text-subtle focus:border-accent focus:outline-none"
                placeholder="Search templates…"
                type="text"
            />
        </div>
        <Button onclick={() => (filtersOpen = true)} variant="outline">
            <ListFilter class="size-4" />
            Filters
            {#if selectedCategories.length > 0}
                <span
                    class="bg-accent text-accent-foreground rounded-full px-1.5 text-xs"
                >
                    {selectedCategories.length}
                </span>
            {/if}
        </Button>
    </div>

    <div class="mb-8">
        <h2
            class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase"
        >
            Built-in
        </h2>
        {#if filteredBuiltins.length === 0}
            <p class="text-sm text-text-subtle">No built-in templates match.</p>
        {:else}
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {#each filteredBuiltins as tmpl (tmpl.id)}
                    {@render card(tmpl)}
                {/each}
            </div>
        {/if}
    </div>

    <div>
        <h2
            class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase"
        >
            My Templates
        </h2>
        {#if data.mine.length === 0}
            <div
                class="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border py-12 text-center"
            >
                <LayoutGrid class="mb-3 size-8 text-text-muted opacity-40" />
                <p class="text-sm font-medium text-text-muted">
                    No custom templates yet
                </p>
                <p class="mt-1 text-xs text-text-subtle">
                    Build one from scratch, or save an existing service as a
                    template from its Settings tab.
                </p>
            </div>
        {:else if filteredMine.length === 0}
            <p class="text-sm text-text-subtle">No custom templates match.</p>
        {:else}
            <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {#each filteredMine as tmpl (tmpl.id)}
                    {@render card(tmpl)}
                {/each}
            </div>
        {/if}
    </div>

    <p class="mt-10 text-center text-xs text-text-subtle">
        App icons by <a
            class="underline hover:text-text-muted"
            href="https://selfh.st/icons/"
            rel="noopener noreferrer"
            target="_blank">selfh.st/icons</a
        >, licensed under
        <a
            class="underline hover:text-text-muted"
            href="https://creativecommons.org/licenses/by/4.0/"
            rel="noopener noreferrer"
            target="_blank">CC BY 4.0</a
        >.
    </p>
</div>

<Drawer bind:open={filtersOpen} direction="right">
    <DrawerContent class="flex flex-col">
        <DrawerHeader class="flex-row items-center justify-between">
            <DrawerTitle>Filter by category</DrawerTitle>
            <Button
                onclick={() => (filtersOpen = false)}
                size="icon-sm"
                variant="ghost"
            >
                <X class="size-4" />
            </Button>
        </DrawerHeader>
        <div class="flex flex-wrap gap-2 overflow-y-auto px-4 pb-6">
            {#each categories as c (c)}
                {@const selected = selectedCategories.includes(c)}
                <button
                    class="rounded-full border px-3 py-1.5 text-sm capitalize transition-colors {selected
                        ? 'border-accent bg-accent text-accent-foreground'
                        : 'border-border bg-surface text-text-muted hover:bg-surface-2'}"
                    onclick={() => toggleCategory(c)}
                    type="button"
                >
                    {c}
                </button>
            {/each}
        </div>
        {#if selectedCategories.length > 0}
            <div class="border-t border-border px-4 py-3">
                <Button
                    onclick={() => (selectedCategories = [])}
                    size="sm"
                    variant="outline"
                >
                    Clear all
                </Button>
            </div>
        {/if}
    </DrawerContent>
</Drawer>
