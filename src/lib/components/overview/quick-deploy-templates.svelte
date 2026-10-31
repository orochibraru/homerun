<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Plus, Rocket } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { Spinner } from "@orochibraru/ui/spinner";

	import TemplateIcon from "#lib/components/template-icon.svelte";
	import { enhanceToast } from "#lib/toast.js";

	interface Props {
		templates: {
			category: string | null;
			description: string | null;
			icon: string | null;
			id: string;
			name: string;
		}[];
	}

	const { templates }: Props = $props();

	let quickDeploying = $state<string | null>(null);

	function quickDeployEnhance(template: { id: string; name: string }) {
		return enhanceToast({
			error: "Couldn't prepare deployment.",
			loading: `Preparing "${template.name}" for deployment`,
			onSettled: () => {
				quickDeploying = null;
			},
			onStart: () => {
				quickDeploying = template.id;
			},
			success: `"${template.name}" deploying`,
		});
	}
</script>

<section class="panel mb-8 rounded-xl">
	<div class="panel-head">
		<h2 class="eyebrow flex items-center gap-1.5">
			<Rocket class="size-3.5" />
			Deploy an app
		</h2>
		<a
			class="text-accent ml-auto text-xs font-medium hover:underline"
			href={resolve("templates")}>Browse all templates</a
		>
	</div>
	<div class="grid grid-cols-1 gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
		{#each templates as template (template.id)}
			<div class="border-border flex flex-col gap-3 rounded-lg border p-3">
				<a
					class="flex min-w-0 flex-1 items-start gap-3"
					href={resolve("/(protected)/templates/[templateId]", {
						templateId: template.id,
					})}
				>
					<TemplateIcon
						category={template.category}
						class="size-9 shrink-0"
						icon={template.icon}
					/>
					<span class="min-w-0">
						<span class="text-text block truncate text-sm font-medium"
							>{template.name}</span
						>
						<span class="text-text-muted line-clamp-2 text-xs"
							>{template.description}</span
						>
					</span>
				</a>
				<form
					action="{resolve('templates')}?/quickDeploy"
					method="POST"
					use:enhance={quickDeployEnhance(template)}
				>
					<input name="templateId" type="hidden" value={template.id} />
					<Button
						class="w-full"
						disabled={quickDeploying !== null}
						size="sm"
						type="submit"
					>
						{#if quickDeploying === template.id}
							<Spinner />
							Deploying…
						{:else}
							<Rocket class="size-3.5" />
							Quick Deploy
						{/if}
					</Button>
				</form>
			</div>
		{/each}
	</div>
	<div
		class="border-border flex flex-wrap items-center gap-2 border-t px-4 py-3"
	>
		<p class="text-text-muted flex-1 text-xs">
			Not in the list? Browse all templates, or point at any Docker image.
		</p>
		<Button href={resolve("services/new")} size="sm" variant="outline">
			<Plus class="size-3.5" />
			Deploy an image
		</Button>
	</div>
</section>
