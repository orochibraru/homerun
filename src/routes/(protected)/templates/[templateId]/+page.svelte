<script lang="ts">
	import {
		ArrowLeft,
		ExternalLink,
		GitBranch,
		GlobeIcon,
		Rocket,
		SettingsIcon,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import TemplateIcon from "$lib/components/template-icon.svelte";
	import { Button } from "$lib/components/ui/button";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();
	const tmpl = $derived(data.template);

	let deploying = $state(false);

	onMount(() => title.set(tmpl.name));

	const configureHref = $derived(
		`${resolve("/services/new")}?templateId=${tmpl.id}${
			data.project ? `&projectId=${data.project.id}` : ""
		}`,
	);
</script>

<div class="space-y-6 p-6 md:p-8">
    <a
        class="inline-flex items-center gap-1.5 text-sm text-text-muted hover:text-text"
        href={resolve("/templates")}
    >
        <ArrowLeft class="size-3.5" />
        Templates
    </a>

    <div class="flex flex-wrap items-start justify-between gap-4">
        <div class="flex items-center gap-4">
            <TemplateIcon
                category={tmpl.category}
                class="size-14"
                icon={tmpl.icon}
            />
            <div>
                <h1 class="text-2xl font-bold text-text">{tmpl.name}</h1>
                <p class="font-mono text-sm text-text-muted">
                    {tmpl.image}:{tmpl.tag}
                </p>
            </div>
        </div>
        <div class="flex gap-2">
            <form
                action="?/quickDeploy"
                use:enhance={() => {
                    deploying = true;
                    return async ({ result, update }) => {
                        deploying = false;
                        if (result.type === "failure") {
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
                        await update();
                    };
                }}
                method="POST"
            >
                {#if data.project}
                    <input
                        name="projectId"
                        type="hidden"
                        value={data.project.id}
                    />
                {/if}
                <Button disabled={deploying} size="sm" type="submit">
                    {#if deploying}
                        <Spinner />
                        Deploying…
                    {:else}
                        <Rocket class="size-3.5" />
                        Quick Deploy
                    {/if}
                </Button>
            </form>
            <Button href={configureHref} size="sm" variant="outline">
                <SettingsIcon class="size-3.5" />
                Configure
            </Button>
        </div>
    </div>

    {#if tmpl.description}
        <p class="max-w-2xl text-sm text-text-muted">{tmpl.description}</p>
    {/if}

    {#if tmpl.sourceUrl || tmpl.websiteUrl}
        <div class="flex flex-wrap gap-3">
            {#if tmpl.sourceUrl}
                <a
                    class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2"
                    href={tmpl.sourceUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                >
                    <GitBranch class="size-3.5" />
                    Source code
                    <ExternalLink class="size-2.5 self-start" />
                </a>
            {/if}
            {#if tmpl.websiteUrl}
                <a
                    class="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text hover:bg-surface-2"
                    href={tmpl.websiteUrl}
                    rel="noopener noreferrer"
                    target="_blank"
                >
                    <GlobeIcon class="size-3.5" />
                    Website
                    <ExternalLink class="size-2.5 self-start" />
                </a>
            {/if}
        </div>
    {/if}

    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="rounded-2xl border border-border bg-surface p-5">
            <h2
                class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase"
            >
                Container
            </h2>
            <dl class="space-y-2 text-sm">
                <div class="flex justify-between gap-4">
                    <dt class="text-text-muted">Port</dt>
                    <dd class="font-mono text-text">{tmpl.containerPort}</dd>
                </div>
                {#if tmpl.category}
                    <div class="flex justify-between gap-4 capitalize">
                        <dt class="text-text-muted">Category</dt>
                        <dd class="text-text">{tmpl.category}</dd>
                    </div>
                {/if}
                {#if tmpl.cpuLimit}
                    <div class="flex justify-between gap-4">
                        <dt class="text-text-muted">CPU limit</dt>
                        <dd class="font-mono text-text">{tmpl.cpuLimit}</dd>
                    </div>
                {/if}
                {#if tmpl.memoryLimitMb}
                    <div class="flex justify-between gap-4">
                        <dt class="text-text-muted">Memory limit</dt>
                        <dd class="font-mono text-text">
                            {tmpl.memoryLimitMb} MB
                        </dd>
                    </div>
                {/if}
            </dl>
        </div>

        {#if Object.keys(tmpl.envVars ?? {}).length > 0}
            <div class="rounded-2xl border border-border bg-surface p-5">
                <h2
                    class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase"
                >
                    Env vars
                </h2>
                <dl class="space-y-2 text-sm">
                    {#each Object.entries(tmpl.envVars ?? {}) as [key, value] (key)}
                        <div class="flex justify-between gap-4">
                            <dt class="font-mono text-text-muted">{key}</dt>
                            <dd class="truncate font-mono text-text">
                                {value}
                            </dd>
                        </div>
                    {/each}
                </dl>
            </div>
        {/if}
    </div>

    {#if data.links.length > 0}
        <div class="rounded-2xl border border-border bg-surface p-5">
            <h2
                class="mb-3 text-xs font-semibold tracking-widest text-text-subtle uppercase"
            >
                Deploys alongside
            </h2>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {#each data.links as link (link.alias)}
                    <div
                        class="flex items-center gap-3 rounded-xl border border-border p-3"
                    >
                        <TemplateIcon
                            category={null}
                            class="size-8"
                            icon={link.icon}
                        />
                        <div class="min-w-0">
                            <p class="truncate text-sm font-medium text-text">
                                {link.name}
                            </p>
                            <p
                                class="truncate font-mono text-xs text-text-subtle"
                            >
                                {link.image}:{link.tag} · alias {link.alias}
                            </p>
                        </div>
                    </div>
                {/each}
            </div>
        </div>
    {/if}
</div>
