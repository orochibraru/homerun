<script lang="ts">
	import { resolve } from "$app/paths";
	import { Globe, Plus } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";

	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityList from "#lib/components/entity-list.svelte";
	import { ViewMode } from "#lib/view-mode.svelte.js";

	const { data } = $props();

	const view = new ViewMode("mail-domains");

	const rows = $derived(
		data.domains.map((domain) => ({
			href: resolve("/(protected)/mail/domains/[domainId]", {
				domainId: domain.id,
			}),
			id: domain.id,
			name: domain.name,
			subtitle: `${domain.mailboxes} ${domain.mailboxes === 1 ? "mailbox" : "mailboxes"} · DKIM selector ${domain.dkimSelector}`,
			title: domain.name,
		})),
	);
	type DomainRow = (typeof rows)[number];
</script>

{#snippet media(_item: DomainRow)}
	<div
		class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md"
	>
		<Globe class="size-5" />
	</div>
{/snippet}

<div class="mb-4 flex justify-end">
	<Button href={resolve("mail/domains/new")}
		><Plus class="size-4" />New domain</Button
	>
</div>

{#if rows.length === 0}
	<EmptyState
		icon={Globe}
		subtitle="Add the domain you want addresses on, then point its DNS here."
		title="No mail domains yet"
	/>
{:else}
	<EntityList items={rows} {media} {view} />
{/if}
