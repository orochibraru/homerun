<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { ArrowLeft, Plus, Ticket } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { Input } from "@orochibraru/ui/input";
	import { Spinner } from "@orochibraru/ui/spinner";

	import CodeBlock from "#lib/components/code-block.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { enhanceToast } from "#lib/toast.js";

	const { data, form } = $props();

	const tokensHref = $derived(
		resolve("/(protected)/package-registries/[kind]/tokens", {
			kind: data.kind,
		}),
	);
	let creating = $state(false);
</script>

{#if form?.success && "created" in form && form.created}
	<div class="space-y-4">
		<div
			class="rounded-md border border-emerald-200 bg-emerald-50 p-4 text-sm dark:border-emerald-900/40 dark:bg-emerald-950/20"
		>
			<p class="font-semibold text-emerald-800 dark:text-emerald-400">
				{form.created.username} is ready
			</p>
			<p class="mt-1 text-xs text-emerald-700 dark:text-emerald-400">
				This is the only time the secret is shown: copy what you need now.
			</p>
		</div>
		<div class="grid gap-4 xl:grid-cols-2">
			{#each form.snippets as snippet (snippet.title)}
				<div class="min-w-0">
					<p class="text-text-muted mb-1.5 text-xs font-medium">
						{snippet.title}
					</p>
					<CodeBlock
						code={snippet.code}
						html={snippet.html}
						label={snippet.title}
					/>
				</div>
			{/each}
		</div>
		<Button href={tokensHref} variant="outline">
			<ArrowLeft class="size-4" />
			Back to tokens
		</Button>
	</div>
{:else}
	<section class="panel rounded-md">
		<PanelHeader
			description="A token can install and publish. The secret is generated for you and shown once."
			icon={Ticket}
			title="New token"
		/>
		<form
			action="?/create"
			class="space-y-4 p-5"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't create that token.",
				loading: "Creating the token",
				onSettled: () => {
					creating = false;
				},
				onStart: () => {
					creating = true;
				},
				success: "Token created.",
			})}
		>
			<div>
				<label class="text-text mb-1.5 block text-sm font-medium" for="username"
					>Username</label
				>
				<Input
					autocomplete="off"
					id="username"
					name="username"
					placeholder="ci-pipeline"
					required
				/>
			</div>
			<div class="flex justify-end">
				<Button disabled={creating} type="submit">
					{#if creating}
						<Spinner />
					{:else}
						<Plus class="size-4" />
					{/if}
					Create token
				</Button>
			</div>
		</form>
	</section>
{/if}
