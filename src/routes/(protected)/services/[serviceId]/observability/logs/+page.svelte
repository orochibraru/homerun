<script lang="ts">
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { Ghost, Loader2 } from "@lucide/svelte";
	import { onMount } from "svelte";

	import Alert from "#lib/components/alert.svelte";
	import LiveLogViewer from "#lib/components/live-log-viewer.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { workloadId } from "#lib/service-state.js";
	import { title } from "#lib/store/title.js";
	import { enhanceToast } from "#lib/toast.js";

	const { data } = $props();

	onMount(() => title.set(`${data.service.name} · Logs`));

	let resolving = $state(false);
</script>

<div class="mb-4">
	<LiveLogViewer
		workloadId={workloadId(data.service)}
		serviceId={data.service.id}
		heightClass="h-96"
	/>
	<p class="text-text-muted mt-2 text-xs">
		This is the running container's output. Earlier revisions' logs are in
		<a
			class="text-accent hover:underline"
			href={resolve(
				"/(protected)/services/[serviceId]/observability/log-history",
				{ serviceId: data.service.id },
			)}>Log history</a
		>.
	</p>
</div>

{#if data.service.currentStatus === "failed"}
	<Alert class="mb-6" title="This service's container is currently down.">
		The crash output is in the log stream above.
	</Alert>
{:else if data.service.currentStatus === "missing"}
	<div
		class="mb-6 flex items-start gap-3 rounded-md border border-violet-200 bg-violet-50 p-4 text-sm text-violet-800 dark:border-violet-900/40 dark:bg-violet-950/20 dark:text-violet-300"
	>
		<Ghost class="mt-0.5 size-4 shrink-0" />
		<div class="flex-1">
			<p class="font-medium">This service's container is gone.</p>
			<p class="mt-0.5 text-xs opacity-80">
				Homerun can't find it on the host anymore, it was likely removed
				manually (e.g. `docker rm`) rather than through this app. Resolve to
				clear the stale reference so you can deploy it again.
			</p>
		</div>
		<form
			action="?/resolveOrphan"
			method="POST"
			use:enhance={enhanceToast({
				error: "Couldn't resolve the orphaned container.",
				loading: "Resolving the container",
				onSettled: () => {
					resolving = false;
				},
				onStart: () => {
					resolving = true;
				},
				success: "Container reference cleared.",
			})}
		>
			<Button disabled={resolving} size="sm" type="submit" variant="outline">
				{#if resolving}
					<Loader2 class="size-3.5 animate-spin" />
				{/if}
				Resolve
			</Button>
		</form>
	</div>
{/if}
