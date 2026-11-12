<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Forward, Pencil, Plus } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import { Switch } from "@zedensix/ui/switch";

	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityList from "#lib/components/entity-list.svelte";
	import { queuedJobToast } from "#lib/job-toast.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";

	const { data } = $props();

	const view = new ViewMode("mail-aliases");

	const rows = $derived(
		data.aliases.map((alias) => ({
			catchAll: !alias.localPart,
			enabled: alias.enabled,
			href: resolve("/(protected)/mail/aliases/[aliasId]", {
				aliasId: alias.id,
			}),
			id: alias.id,
			name: alias.address,
			subtitle: `→ ${alias.destinations.join(", ")}`,
			title: alias.localPart ? alias.address : `Anything @${alias.domain}`,
		})),
	);
	type AliasRow = (typeof rows)[number];
</script>

{#snippet media(_item: AliasRow)}
	<div
		class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md"
	>
		<Forward class="size-5" />
	</div>
{/snippet}

{#snippet badge(item: AliasRow)}
	{#if item.catchAll}
		<span
			class="bg-accent/10 text-accent shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
		>
			Catch-all
		</span>
	{/if}
	{#if !item.enabled}
		<span
			class="bg-surface-2 text-text-subtle shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
		>
			Disabled
		</span>
	{/if}
{/snippet}

{#snippet actions(item: AliasRow)}
	<form
		id="toggle-{item.id}"
		action="?/toggle"
		method="POST"
		use:enhance={queuedJobToast({
			error: "Couldn't change the alias.",
			loading: item.enabled ? "Disabling the alias" : "Enabling the alias",
			success: (result) =>
				result?.enabled ? "Alias enabled." : "Alias disabled.",
		})}
	>
		<input name="aliasId" type="hidden" value={item.id} />
		<Switch
			aria-label={item.enabled ? "Disable alias" : "Enable alias"}
			checked={item.enabled}
			class="mx-1"
			onCheckedChange={() =>
				(
					document.getElementById(`toggle-${item.id}`) as HTMLFormElement | null
				)?.requestSubmit()}
		/>
	</form>
	<Button href={item.href} size="icon-sm" title="Edit" variant="ghost">
		<Pencil class="size-4" />
	</Button>
{/snippet}

<div class="mb-4 flex justify-end">
	<Button
		disabled={data.mailStatus.domainCount === 0}
		href={resolve("mail/aliases/new")}><Plus class="size-4" />New alias</Button
	>
</div>

{#if rows.length === 0}
	<EmptyState
		icon={Forward}
		subtitle="Forward an address somewhere else, or catch everything sent to a domain."
		title="No aliases yet"
	/>
{:else}
	<EntityList {actions} {badge} items={rows} {media} {view} />
{/if}
