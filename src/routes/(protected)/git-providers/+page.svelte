<script lang="ts">
	import { refreshAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import { GitBranch, Link2, Plus, RefreshCw, Unlink } from "@lucide/svelte";
	import { Button } from "@zedensix/ui/button";
	import { onMount } from "svelte";
	import { toast } from "svelte-sonner";

	import CopyBox from "#lib/components/copy-box.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import EntityList from "#lib/components/entity-list.svelte";
	import { disconnectGitProvider } from "#lib/remote/git-repos.remote.js";
	import { title } from "#lib/store/title.js";
	import { toastError } from "#lib/toast.js";
	import { ViewMode } from "#lib/view-mode.svelte.js";

	const { data } = $props();

	onMount(() => title.set("Git Providers"));

	const view = new ViewMode("git-providers");

	async function disconnectCallback(providerId: string) {
		await disconnectGitProvider(providerId);
		await refreshAll();
	}

	function handleDisconnect(providerId: string) {
		return toast.promise(disconnectCallback(providerId), {
			error: (error) => toastError(error, "Couldn't disconnect."),
			loading: "Disconnecting",
			success: "Disconnected.",
		});
	}

	const rows = $derived(
		data.providers.map((provider) => ({
			connected: data.connectedProviderIds.includes(provider.id),
			callbackUrl:
				data.canWrite &&
				provider.kind !== "github" &&
				!data.connectedProviderIds.includes(provider.id)
					? callbackUrlFor(provider.id)
					: null,
			enabled: provider.enabled,
			href: resolve("/(protected)/git-providers/[providerId]", {
				providerId: provider.id,
			}),
			id: provider.id,
			name: provider.name,
			subtitle: `${provider.kind}${provider.baseUrl ? ` · ${provider.baseUrl}` : ""}`,
			title: provider.name,
		})),
	);
	type ProviderRow = (typeof rows)[number];

	function callbackUrlFor(providerId: string): string {
		if (typeof window === "undefined") {
			return "";
		}
		return `${window.location.origin}/api/v1/git-providers/${providerId}/callback`;
	}
</script>

{#snippet media(_provider: ProviderRow)}
	<div
		class="bg-accent/10 text-accent flex size-10 shrink-0 items-center justify-center rounded-md"
	>
		<GitBranch class="size-5" />
	</div>
{/snippet}

{#snippet details(provider: ProviderRow)}
	{#if provider.callbackUrl}
		<div class="flex flex-col gap-1">
			<p class="text-text-muted text-xs">
				Callback URL for this provider's OAuth App
			</p>
			<CopyBox
				class="bg-surface-3"
				label="the callback URL"
				value={provider.callbackUrl}
			/>
		</div>
	{/if}
{/snippet}

{#snippet badge(provider: ProviderRow)}
	{#if !provider.enabled}
		<span
			class="bg-surface-2 text-text-subtle shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold"
		>
			Disabled
		</span>
	{:else if provider.connected}
		<span
			class="shrink-0 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[0.65rem] font-semibold text-emerald-600 dark:text-emerald-400"
		>
			Connected
		</span>
	{/if}
{/snippet}

{#snippet actions(provider: ProviderRow)}
	{#if provider.connected}
		{#if provider.enabled}
			<Button
				href={`/api/v1/git-providers/${provider.id}/connect`}
				size="sm"
				variant="outline"
			>
				<RefreshCw class="size-4" />
				Reconnect
			</Button>
		{/if}
		<Button
			onclick={() => handleDisconnect(provider.id)}
			size="sm"
			type="button"
			variant="outline"
		>
			<Unlink class="size-4" />
			Disconnect
		</Button>
	{:else if provider.enabled}
		<Button href={`/api/v1/git-providers/${provider.id}/connect`} size="sm">
			<Link2 class="size-4" />
			Connect
		</Button>
	{/if}
{/snippet}

<div class="p-5 md:p-6">
	<div class="mb-8 flex flex-wrap items-center justify-between gap-4">
		<div>
			<h1 class="text-text text-lg font-semibold tracking-tight max-md:hidden">
				Git Providers
			</h1>
			<p class="text-text-muted mt-1 text-sm">
				Connect a git hosting account (GitHub, GitLab, self-hosted Gitea,
				Bitbucket) so a git-based service's Source tab can browse your repos
				instead of pasting a raw URL : no personal access token needed.
			</p>
		</div>
		{#if data.canWrite}
			<Button href={resolve("git-providers/new")}>
				<Plus class="size-4" />
				New provider
			</Button>
		{/if}
	</div>

	{#if data.providers.length === 0}
		<EmptyState
			icon={GitBranch}
			subtitle="Add one to browse repos when creating a git-based service."
			title="No git providers configured"
		/>
	{:else}
		<EntityList {actions} {badge} {details} items={rows} {media} {view} />
	{/if}
</div>
