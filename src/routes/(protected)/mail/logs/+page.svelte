<script lang="ts">
	import { goto, refreshAll } from "$app/navigation";
	import { page } from "$app/state";
	import { RefreshCw, ScrollText, TriangleAlert } from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { toast } from "svelte-sonner";

	import { inputClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { toastError } from "#lib/toast.js";

	const { data } = $props();

	let query = $state("");
	$effect(() => {
		query = data.q;
	});

	const views = [
		{ id: "all", label: "Everything" },
		{ id: "problems", label: "Warnings and errors" },
		{ id: "deliveries", label: "Deliveries" },
	] as const;

	const tiles = $derived([
		{ label: "Bounced", tone: "text-red-500", value: data.summary.bounced },
		{ label: "Deferred", tone: "text-amber-500", value: data.summary.deferred },
		{
			label: "Failed sign-ins",
			tone: "text-amber-500",
			value: data.summary.failedSignIns,
		},
		{ label: "Other errors", tone: "text-red-500", value: data.summary.errors },
	]);

	function withParam(key: string, value: string): string {
		const url = new URL(page.url.href);
		if (value) {
			url.searchParams.set(key, value);
		} else {
			url.searchParams.delete(key);
		}
		return `${url.pathname}${url.search}`;
	}

	function search(event: SubmitEvent) {
		event.preventDefault();
		void goto(withParam("q", query.trim()), { reset: false });
	}

	function handleRefresh() {
		return toast.promise(refreshAll(), {
			error: (err) => toastError(err, "Couldn't reload the logs."),
			loading: "Reloading the logs",
			success: "Logs reloaded.",
		});
	}
</script>

<div class="mb-6 grid gap-3 sm:grid-cols-4">
	{#each tiles as tile (tile.label)}
		<div class="panel rounded-md px-4 py-3">
			<p class="text-text-muted text-xs">{tile.label}</p>
			<p
				class="mt-1 text-2xl font-semibold {tile.value > 0
					? tile.tone
					: 'text-text'}"
			>
				{tile.value}
			</p>
		</div>
	{/each}
</div>

{#if data.failures.length > 0}
	<section class="panel mb-6 rounded-md">
		<PanelHeader
			description="The receiving server's own answer, newest first. A deferred message is retried for five days before it bounces."
			icon={TriangleAlert}
			title="Delivery failures"
		/>
		<ul class="divide-border divide-y">
			{#each data.failures as failure, index (index)}
				<li class="px-5 py-3 text-sm">
					<p class="text-text">
						<span
							class="mr-2 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold {failure.status ===
							'bounced'
								? 'bg-red-500/10 text-red-600'
								: 'bg-amber-500/10 text-amber-600'}">{failure.status}</span
						>{failure.recipient}
						{#if failure.time}
							<span class="text-text-subtle ml-2 text-xs"
								>{new Date(failure.time).toLocaleString()}</span
							>
						{/if}
					</p>
					<p class="text-text-muted mt-1 font-mono text-xs break-all">
						{failure.reason}
					</p>
				</li>
			{/each}
		</ul>
	</section>
{/if}

<section class="panel rounded-md">
	<PanelHeader
		description="What Postfix, Dovecot and rspamd printed, from the mail container's output. {data
			.lines.length} of the last {data.total} lines shown."
		icon={ScrollText}
		title="Logs"
	>
		{#snippet trailing()}
			<Button onclick={handleRefresh} size="sm" variant="outline"
				><RefreshCw class="size-4" />Reload</Button
			>
		{/snippet}
	</PanelHeader>
	<div
		class="border-border flex flex-wrap items-center gap-2 border-b px-5 py-3"
	>
		{#each views as view (view.id)}
			<Button
				href={withParam("view", view.id === "all" ? "" : view.id)}
				size="sm"
				variant={data.view === view.id ? "default" : "ghost"}
				>{view.label}</Button
			>
		{/each}
		<span class="text-text-subtle ml-2 text-xs">Last</span>
		{#each data.tailChoices as choice (choice)}
			<Button
				href={withParam("tail", String(choice))}
				size="sm"
				variant={data.tail === choice ? "secondary" : "ghost"}>{choice}</Button
			>
		{/each}
		<form class="ml-auto w-full sm:w-64" onsubmit={search}>
			<input
				class={inputClass}
				aria-label="Search the logs"
				placeholder="Search, e.g. an address or a queue id"
				type="search"
				bind:value={query}
			/>
		</form>
	</div>
	{#if data.lines.length === 0}
		<p class="text-text-muted px-5 py-8 text-center text-sm">
			{data.total === 0
				? "Nothing logged: the mail server isn't running, or hasn't printed anything yet."
				: "No line matches."}
		</p>
	{:else}
		<pre
			class="bg-surface-2 max-h-[70vh] overflow-auto px-5 py-3 font-mono text-xs leading-relaxed">{#each data.lines as line, index (index)}<span
				class="block whitespace-pre-wrap {line.level === 'error'
					? 'text-red-600 dark:text-red-400'
					: line.level === 'warn'
						? 'text-amber-600 dark:text-amber-400'
						: 'text-text'}">{line.raw}</span
			>{/each}</pre>
	{/if}
</section>
