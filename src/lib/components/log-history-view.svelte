<script lang="ts" module>
	export interface LogHistoryDeployment {
		createdAt: Date;
		gitCommit: string | null;
		id: string;
		imageRef: string | null;
	}
</script>

<script lang="ts">
	import { page } from "$app/state";
	import {
		ChevronLeft,
		Download,
		History,
		Search,
		SearchX,
	} from "@lucide/svelte";
	import { Button } from "@orochibraru/ui/button";
	import { Input } from "@orochibraru/ui/input";
	import * as Select from "@orochibraru/ui/select";
	import type { Snippet } from "svelte";

	import Alert from "#lib/components/alert.svelte";
	import AnsiLine from "#lib/components/ansi-line.svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { labelClass } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { formatDate } from "#lib/formatting.js";
	import { LOG_RANGE_LABELS, type LogHistoryView } from "#lib/logs/history.js";

	interface Props {
		deployments?: LogHistoryDeployment[];
		description: string;
		downloadHref: string;
		history: LogHistoryView;
		instanceLabel: string;
		picker?: Snippet;
	}

	const {
		deployments,
		description,
		downloadHref,
		history,
		instanceLabel,
		picker,
	}: Props = $props();

	const ANY = "any";

	let range = $derived(String(history.filters.range));
	let deploymentId = $derived(history.filters.deploymentId || ANY);
	let instance = $derived(history.filters.instance || ANY);
	let stream = $derived(history.filters.stream || ANY);
	let fromLocal = $derived(toLocalInput(history.filters.from));
	let toLocal = $derived(toLocalInput(history.filters.to));

	const lines = $derived(history.page.lines.toReversed());
	const deploymentsById = $derived(
		new Map((deployments ?? []).map((dep) => [dep.id, dep])),
	);
	const rangeLabel = $derived(
		LOG_RANGE_LABELS.find(([value]) => value === range)?.[1] ?? "Last 24 hours",
	);
	const searchParams = $derived.by(() => {
		const params = new URLSearchParams(page.url.search);
		params.delete("before");
		return params;
	});
	const olderHref = $derived.by(() => {
		if (!history.page.nextCursor) {
			return null;
		}
		const params = new URLSearchParams(searchParams);
		params.set("before", history.page.nextCursor);
		return `?${params}`;
	});
	const newestHref = $derived(`?${searchParams}`);
	const fullDownloadHref = $derived(`${downloadHref}?${searchParams}`);
	const kept = $derived(
		`Kept ${history.retentionDays} days.${history.oldest ? ` Oldest line kept: ${formatDate(history.oldest)}.` : ""}`,
	);

	/** An ISO time as a datetime-local input's value, in the browser's time zone. */
	function toLocalInput(iso: string): string {
		if (!iso) {
			return "";
		}
		const date = new Date(iso);
		if (Number.isNaN(date.getTime())) {
			return "";
		}
		const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
		return local.toISOString().slice(0, 16);
	}

	/** A datetime-local input's value as an ISO time, empty when it's blank. */
	function toIso(local: string): string {
		if (!local) {
			return "";
		}
		const date = new Date(local);
		return Number.isNaN(date.getTime()) ? "" : date.toISOString();
	}

	/** A stored line's time in the browser's time zone, to the millisecond. */
	function formatTime(iso: string): string {
		return new Date(iso).toLocaleString(undefined, {
			day: "2-digit",
			fractionalSecondDigits: 3,
			hour: "2-digit",
			hour12: false,
			minute: "2-digit",
			month: "short",
			second: "2-digit",
		});
	}

	/** A deployment as the revision filter and each line's badge name it. */
	function deploymentLabel(id: string): string {
		const dep = deploymentsById.get(id);
		if (!dep) {
			return id.slice(0, 8);
		}
		const what = dep.gitCommit?.slice(0, 7) ?? dep.imageRef ?? "";
		return `${formatDate(dep.createdAt)} · ${id.slice(0, 8)}${what ? ` · ${what}` : ""}`;
	}
</script>

<div class="space-y-6">
	<section class="panel rounded-md">
		<PanelHeader
			description="{description} {kept}"
			icon={History}
			title="Log history"
		>
			{#snippet trailing()}
				<Button download href={fullDownloadHref} size="sm" variant="outline">
					<Download class="size-3.5" />
					Download
				</Button>
			{/snippet}
		</PanelHeader>
		<form class="grid gap-4 p-5 md:grid-cols-6" method="GET">
			{#if picker}
				<div class="md:col-span-6">
					{@render picker()}
				</div>
			{/if}
			<div class="md:col-span-4">
				<label class={labelClass} for="log-q">Search</label>
				<Input
					id="log-q"
					name="q"
					placeholder="Text the line contains, e.g. ECONNREFUSED"
					value={history.filters.q}
				/>
			</div>
			<div class="md:col-span-2">
				<CheckBox
					checked={history.filters.regex}
					helperText="Read the search as a case-insensitive POSIX regex."
					id="log-regex"
					label="Regular expression"
					name="regex"
				/>
			</div>
			<div>
				<label class={labelClass} for="log-range">Time</label>
				<Select.Root name="range" type="single" bind:value={range}>
					<Select.Trigger id="log-range" class="w-full">
						{rangeLabel}
					</Select.Trigger>
					<Select.Content>
						{#each LOG_RANGE_LABELS as [value, label] (value)}
							<Select.Item {label} {value} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div>
				<label class={labelClass} for="log-from">From</label>
				<Input id="log-from" type="datetime-local" bind:value={fromLocal} />
				<input name="from" type="hidden" value={toIso(fromLocal)} />
			</div>
			<div>
				<label class={labelClass} for="log-to">To</label>
				<Input id="log-to" type="datetime-local" bind:value={toLocal} />
				<input name="to" type="hidden" value={toIso(toLocal)} />
			</div>
			{#if deployments}
				<div>
					<label class={labelClass} for="log-deployment">Revision</label>
					<Select.Root type="single" bind:value={deploymentId}>
						<Select.Trigger id="log-deployment" class="w-full">
							<span class="truncate"
								>{deploymentId === ANY
									? "Any revision"
									: deploymentLabel(deploymentId)}</span
							>
						</Select.Trigger>
						<Select.Content>
							<Select.Item label="Any revision" value={ANY} />
							{#each deployments as dep (dep.id)}
								<Select.Item label={deploymentLabel(dep.id)} value={dep.id} />
							{/each}
						</Select.Content>
					</Select.Root>
					<input
						name="deploymentId"
						type="hidden"
						value={deploymentId === ANY ? "" : deploymentId}
					/>
				</div>
			{/if}
			<div>
				<label class={labelClass} for="log-instance">{instanceLabel}</label>
				<Select.Root type="single" bind:value={instance}>
					<Select.Trigger id="log-instance" class="w-full">
						<span class="truncate font-mono"
							>{instance === ANY
								? `Any ${instanceLabel.toLowerCase()}`
								: instance}</span
						>
					</Select.Trigger>
					<Select.Content>
						<Select.Item
							label="Any {instanceLabel.toLowerCase()}"
							value={ANY}
						/>
						{#each history.instances as name (name)}
							<Select.Item label={name} value={name} />
						{/each}
					</Select.Content>
				</Select.Root>
				<input
					name="instance"
					type="hidden"
					value={instance === ANY ? "" : instance}
				/>
			</div>
			<div class={deployments ? "" : "md:col-span-2"}>
				<label class={labelClass} for="log-stream">Stream</label>
				<Select.Root type="single" bind:value={stream}>
					<Select.Trigger id="log-stream" class="w-full">
						{stream === ANY ? "Both" : stream}
					</Select.Trigger>
					<Select.Content>
						<Select.Item label="Both" value={ANY} />
						<Select.Item label="stdout" value="stdout" />
						<Select.Item label="stderr" value="stderr" />
					</Select.Content>
				</Select.Root>
				<input
					name="stream"
					type="hidden"
					value={stream === ANY ? "" : stream}
				/>
			</div>
			<div class="flex items-end justify-end md:col-span-6">
				<Button type="submit">
					<Search class="size-3.5" />
					Search
				</Button>
			</div>
		</form>
	</section>

	{#if history.error}
		<Alert title="Couldn't search the logs." variant="warning">
			{history.error}
		</Alert>
	{/if}

	{#if lines.length === 0}
		<EmptyState
			icon={SearchX}
			subtitle={history.oldest
				? "Widen the time range or loosen the search."
				: "Lines show up here a few seconds after the container writes them."}
			title={history.oldest ? "No lines match." : "Nothing stored yet."}
		/>
	{:else}
		<section class="panel rounded-md">
			<div
				class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3"
			>
				<p class="text-text-muted text-xs">
					{lines.length} lines, oldest first{history.page.nextCursor
						? ", older ones on the next page"
						: ""}
				</p>
				<div class="flex gap-2">
					{#if history.filters.paged}
						<Button href={newestHref} size="sm" variant="ghost">Newest</Button>
					{/if}
					{#if olderHref}
						<Button href={olderHref} size="sm" variant="outline">
							<ChevronLeft class="size-3.5" />
							Older
						</Button>
					{/if}
				</div>
			</div>
			<div class="log-output max-h-[70vh] overflow-y-auto">
				{#each lines as line (line.id)}
					<div
						class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 {deployments
							? 'md:grid-cols-[auto_auto_auto_minmax(0,1fr)]'
							: 'md:grid-cols-[auto_auto_minmax(0,1fr)]'}"
					>
						<time class="text-zinc-500" datetime={line.time} title={line.time}
							>{formatTime(line.time)}</time
						>
						<span class="hidden text-zinc-500 md:inline" title={instanceLabel}
							>{line.instance}</span
						>
						{#if deployments}
							<span
								class="hidden text-zinc-500 md:inline"
								title={line.deploymentId
									? deploymentLabel(line.deploymentId)
									: "Unknown revision"}
								>{line.deploymentId?.slice(0, 8) ?? "–"}</span
							>
						{/if}
						<div class={line.stream === "stderr" ? "text-red-300" : ""}>
							<AnsiLine line={line.line} />
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</div>
