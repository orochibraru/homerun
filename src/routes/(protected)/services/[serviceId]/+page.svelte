<script lang="ts">
	import {
		Clock,
		Loader2,
		Play,
		Rocket,
		RotateCw,
		Square,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import StatusBadge from "$lib/components/status-badge.svelte";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";

	const { data, form } = $props();

	const svc = $derived(data.service);

	onMount(() => title.set(svc.name));

	let pendingAction = $state<string | null>(null);

	function withPending(action: string) {
		pendingAction = action;
		return () => {
			return async ({
				result,
				update,
			}: {
				result: { type: string; data?: { error?: string } };
				update: () => Promise<void>;
			}) => {
				pendingAction = null;
				if (result.type === "failure" && result.data?.error) {
					toast.error(result.data.error);
				} else if (result.type === "success") {
					toast.success("Done.");
				}
				await update();
			};
		};
	}
</script>

<!-- ═══ Actions ═══ -->
<div class="mb-6 flex flex-wrap gap-2">
	<form method="POST" action="?/deploy" use:enhance={withPending("deploy")}>
		<button
			type="submit"
			disabled={pendingAction !== null}
			class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
		>
			{#if pendingAction === "deploy"}
				<Loader2 class="size-4 animate-spin" />
				{svc.containerId ? "Deploying…" : "Deploying…"}
			{:else}
				<Rocket class="size-4" />
				{svc.containerId ? "Redeploy" : "Deploy"}
			{/if}
		</button>
	</form>

	{#if svc.containerId}
		{#if svc.desiredState === "running"}
			<form method="POST" action="?/stop" use:enhance={withPending("stop")}>
				<button
					type="submit"
					disabled={pendingAction !== null}
					class="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if pendingAction === "stop"}
						<Loader2 class="size-4 animate-spin" />
					{:else}
						<Square class="size-4" />
					{/if}
					Stop
				</button>
			</form>
		{:else}
			<form method="POST" action="?/start" use:enhance={withPending("start")}>
				<button
					type="submit"
					disabled={pendingAction !== null}
					class="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
				>
					{#if pendingAction === "start"}
						<Loader2 class="size-4 animate-spin" />
					{:else}
						<Play class="size-4" />
					{/if}
					Start
				</button>
			</form>
		{/if}

		<form method="POST" action="?/restart" use:enhance={withPending("restart")}>
			<button
				type="submit"
				disabled={pendingAction !== null}
				class="flex items-center gap-2 rounded-xl border border-[var(--color-border)] px-4 py-2.5 text-sm font-medium text-[var(--color-text)] transition-all hover:bg-[var(--color-surface-2)] disabled:cursor-not-allowed disabled:opacity-60"
			>
				{#if pendingAction === "restart"}
					<Loader2 class="size-4 animate-spin" />
				{:else}
					<RotateCw class="size-4" />
				{/if}
				Restart
			</button>
		</form>
	{/if}
</div>

{#if !svc.containerId}
	<div
		class="mb-6 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-2)] p-4 text-sm text-[var(--color-text-muted)]"
	>
		This service hasn't been deployed yet — click <strong>Deploy</strong> to pull
		<span class="font-mono text-[var(--color-text)]">{svc.image}:{svc.tag}</span>
		and start it.
	</div>
{/if}

<!-- ═══ Deployment history ═══ -->
<section
	class="rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]"
>
	<div class="flex items-center gap-2 border-b border-[var(--color-border)] px-5 py-4">
		<Clock class="size-4 text-[var(--color-text-muted)]" />
		<h2 class="text-sm font-semibold text-[var(--color-text)]">
			Deployment history
		</h2>
	</div>

	{#if data.deployments.length === 0}
		<div class="flex flex-col items-center justify-center py-12 text-center">
			<p class="text-sm font-medium text-[var(--color-text-muted)]">
				No deployments yet
			</p>
		</div>
	{:else}
		<div class="divide-y divide-[var(--color-border)]">
			{#each data.deployments as dep (dep.id)}
				<div class="flex items-center gap-4 px-5 py-3">
					<StatusBadge status={dep.status} />
					<div class="min-w-0 flex-1">
						<p class="truncate text-xs text-[var(--color-text-muted)]">
							{timeAgo(dep.createdAt)}
							{#if dep.imageDigest}
								· <span class="font-mono">{dep.imageDigest.slice(0, 19)}</span>
							{/if}
						</p>
						{#if dep.errorMessage}
							<p class="mt-0.5 truncate text-xs text-red-500">
								{dep.errorMessage}
							</p>
						{/if}
					</div>
				</div>
			{/each}
		</div>
	{/if}
</section>
