<script lang="ts">
	import { Loader2 } from "@lucide/svelte";
	import type { Component, Snippet } from "svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import type { CleanupItem } from "#lib/services/docker.service.js";
	import { enhance, type SubmitFunction } from "$app/forms";
	import CleanupItemList from "./cleanup-item-list.svelte";

	interface Props {
		action: string;
		buttonLabel: string;
		dimTagged?: boolean;
		extraFields?: Snippet;
		icon: Component<{ class?: string }>;
		items: CleanupItem[];
		onConfirm: (e: MouseEvent) => void;
		pendingAction: string | null;
		submit: SubmitFunction;
		title: string;
	}

	const {
		action,
		buttonLabel,
		dimTagged = false,
		extraFields,
		icon,
		items,
		onConfirm,
		pendingAction,
		submit,
		title,
	}: Props = $props();
</script>

<section class="panel rounded-md">
	<form
		action="?/{action}"
		method="POST"
		use:enhance={submit}
	>
		<PanelHeader icon={icon} title={title}>
			{#snippet trailing()}
				<Button
					disabled={pendingAction !== null}
					onclick={onConfirm}
					size="sm"
					type="button"
					variant="outline"
				>
					{#if pendingAction === action}
						<Loader2 class="size-3.5 animate-spin" />
					{/if}
					{buttonLabel}
				</Button>
			{/snippet}
		</PanelHeader>
		<div class="space-y-3 p-5">
			{@render extraFields?.()}
			<CleanupItemList dimTagged={dimTagged} items={items} />
		</div>
	</form>
</section>
