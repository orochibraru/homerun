<script lang="ts">
	import {
		ArrowLeft,
		ChevronLeft,
		ChevronRight,
		CircleCheck,
		ExternalLink,
		EyeOff,
		RotateCcw,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";
	import { page } from "$app/state";
	import EnvironmentBadge from "$lib/components/environment-badge.svelte";
	import ErrorLevelBadge from "$lib/components/error-level-badge.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import type { StoredFrame } from "$lib/error-tracking/event";
	import { timeAgo } from "$lib/formatting";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();
	const svc = $derived(data.service);
	const issue = $derived(data.issue);
	const payload = $derived(data.payload);

	onMount(() => title.set(`${svc.name} · ${data.issue.title}`));

	const errorsHref = $derived(
		resolve("/(protected)/services/[serviceId]/errors", { serviceId: svc.id }),
	);

	function eventHref(eventId: string): string {
		const url = new URL(page.url);
		url.searchParams.set("event", eventId);
		return `${url.pathname}${url.search}`;
	}

	interface FrameGroup {
		collapsed: boolean;
		frames: { frame: StoredFrame; index: number }[];
	}

	function groupFrames(frames: StoredFrame[]): FrameGroup[] {
		const anyInApp = frames.some((frame) => frame.inApp);
		const groups: FrameGroup[] = [];
		for (let index = frames.length - 1; index >= 0; index -= 1) {
			const frame = frames[index];
			const collapsed = anyInApp && !frame.inApp;
			const last = groups.at(-1);
			if (last && last.collapsed && collapsed) {
				last.frames.push({ frame, index });
			} else {
				groups.push({ collapsed, frames: [{ frame, index }] });
			}
		}
		return groups;
	}

	function location(frame: StoredFrame): string {
		const file = frame.filename ?? frame.absPath ?? frame.module ?? "?";
		const line = frame.lineno
			? `:${frame.lineno}${frame.colno ? `:${frame.colno}` : ""}`
			: "";
		return `${file}${line}`;
	}

	const STATUS_ACTIONS = [
		{ icon: CircleCheck, label: "Resolve", status: "resolved" },
		{ icon: EyeOff, label: "Ignore", status: "ignored" },
		{ icon: RotateCcw, label: "Reopen", status: "unresolved" },
	] as const;

	const facts = $derived([
		["Events", String(issue.count)],
		["Users", String(data.usersAffected)],
		["First seen", timeAgo(issue.firstSeen)],
		["Last seen", timeAgo(issue.lastSeen)],
		["First release", issue.firstRelease ?? "-"],
		["Last release", issue.lastRelease ?? "-"],
	]);
</script>

{#snippet frameRow(exceptionIndex: number, frame: StoredFrame, index: number)}
  {@const link = data.links[`${exceptionIndex}:${index}`]}
  <li class="px-3 py-2">
    <div class="flex flex-wrap items-baseline gap-x-2 gap-y-1 font-mono text-xs">
      <span class="text-text font-medium break-all">{frame.function ?? "<anonymous>"}</span>
      <span class="text-text-muted break-all">{location(frame)}</span>
      {#if frame.inApp}
        <span class="text-accent text-[0.625rem] font-semibold tracking-[0.08em] uppercase">in app</span>
      {/if}
      {#if link}
        <a
          class="text-accent inline-flex items-center gap-1 font-sans hover:underline"
          href={link}
          rel="noopener noreferrer"
          target="_blank"
        >
          View in repo
          <ExternalLink class="size-3" />
        </a>
      {/if}
    </div>
    {#if frame.contextLine !== null && (frame.inApp || !data.payload?.exceptions.some((exception) => exception.frames.some((candidate) => candidate.inApp)))}
      <pre class="bg-surface-2 mt-2 overflow-x-auto rounded-md py-2 font-mono text-xs">{#each frame.preContext as line, offset (offset)}<span class="text-text-subtle block px-3"><span class="inline-block w-10 select-none">{frame.lineno ? frame.lineno - frame.preContext.length + offset : ""}</span>{line}</span>{/each}<span class="bg-red-500/10 text-text block px-3"><span class="inline-block w-10 select-none">{frame.lineno ?? ""}</span>{frame.contextLine}</span>{#each frame.postContext as line, offset (offset)}<span class="text-text-subtle block px-3"><span class="inline-block w-10 select-none">{frame.lineno ? frame.lineno + offset + 1 : ""}</span>{line}</span>{/each}</pre>
    {/if}
  </li>
{/snippet}

<div class="space-y-6">
  <div class="space-y-3">
    <a class="text-text-muted hover:text-text inline-flex items-center gap-1 text-sm" href={errorsHref}>
      <ArrowLeft class="size-3.5" />
      All errors
    </a>
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="min-w-0 space-y-1">
        <div class="flex flex-wrap items-center gap-2">
          <ErrorLevelBadge level={issue.level} />
          <span class="text-text-subtle text-xs uppercase">{issue.status}</span>
          {#if issue.regressedAt && issue.status === "unresolved"}
            <span class="text-xs text-amber-600">regressed {timeAgo(issue.regressedAt)}</span>
          {/if}
        </div>
        <h2 class="text-text text-base font-semibold break-words">{issue.title}</h2>
        {#if issue.culprit}
          <p class="text-text-muted font-mono text-xs break-all">{issue.culprit}</p>
        {/if}
      </div>
      <div class="flex flex-wrap gap-2">
        {#each STATUS_ACTIONS.filter((action) => action.status !== issue.status) as action (action.status)}
          <form
            action="?/status"
            method="POST"
            use:enhance={enhanceToast({
              error: "Couldn't update the issue.",
              loading: "Updating the issue",
              success: `Issue ${action.status === "unresolved" ? "reopened" : action.status}.`,
            })}
          >
            <input name="status" type="hidden" value={action.status} />
            <Button size="sm" type="submit" variant="outline">
              <action.icon class="size-3.5" />
              {action.label}
            </Button>
          </form>
        {/each}
      </div>
    </div>
  </div>

  <dl class="panel grid grid-cols-2 gap-4 rounded-md p-4 sm:grid-cols-3 lg:grid-cols-6">
    {#each facts as [name, value] (name)}
      <div class="min-w-0">
        <dt class="text-text-subtle text-xs">{name}</dt>
        <dd class="text-text truncate font-mono text-sm" title={value}>{value}</dd>
      </div>
    {/each}
  </dl>

  {#if !data.event || !payload}
    <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
      <p class="text-text-muted text-sm">No events of this issue are retained any more.</p>
    </div>
  {:else}
    <section class="panel rounded-md">
      <div class="border-border flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <div class="flex flex-wrap items-center gap-2 text-sm">
          <span class="text-text font-medium">Event</span>
          <span class="text-text-muted" title={new Date(payload.timestamp).toLocaleString()}>
            {timeAgo(payload.timestamp)}
          </span>
          {#if payload.environment}
            <EnvironmentBadge environment={payload.environment} />
          {/if}
          {#if payload.release}
            <span class="text-text-muted font-mono text-xs" title="Release">{payload.release.length > 16 ? payload.release.slice(0, 12) : payload.release}</span>
          {/if}
        </div>
        {#if data.neighbours}
          <div class="flex items-center gap-1">
            <span class="text-text-subtle mr-1 text-xs">{data.neighbours.total} retained</span>
            <Button
              aria-label="Older event"
              disabled={!data.neighbours.older}
              href={data.neighbours.older ? eventHref(data.neighbours.older) : undefined}
              size="icon-sm"
              variant="outline"
            >
              <ChevronLeft class="size-4" />
            </Button>
            <Button
              aria-label="Newer event"
              disabled={!data.neighbours.newer}
              href={data.neighbours.newer ? eventHref(data.neighbours.newer) : undefined}
              size="icon-sm"
              variant="outline"
            >
              <ChevronRight class="size-4" />
            </Button>
          </div>
        {/if}
      </div>

      <div class="space-y-5 p-4">
        {#if payload.exceptions.length === 0 && payload.message}
          <pre class="bg-surface-2 text-text overflow-x-auto rounded-md p-3 font-mono text-xs whitespace-pre-wrap">{payload.message}</pre>
        {/if}

        {#each payload.exceptions.map((exception, index) => ({ exception, index })).toReversed() as { exception, index } (index)}
          <div class="space-y-2">
            <div>
              <p class="text-text font-mono text-sm font-semibold break-all">{exception.type ?? "Error"}</p>
              {#if exception.value}
                <p class="text-text-muted text-sm break-words whitespace-pre-wrap">{exception.value}</p>
              {/if}
              {#if exception.mechanism}
                <p class="text-text-subtle mt-1 text-xs">
                  {exception.mechanism}{exception.handled === false ? ", unhandled" : exception.handled ? ", handled" : ""}
                </p>
              {/if}
            </div>
            {#if exception.frames.length > 0}
              <ol class="divide-border border-border divide-y rounded-md border">
                {#each groupFrames(exception.frames) as group, groupIndex (groupIndex)}
                  {#if group.collapsed}
                    <li>
                      <details>
                        <summary class="text-text-subtle hover:bg-surface-2 cursor-pointer px-3 py-2 text-xs">
                          {group.frames.length} library {group.frames.length === 1 ? "frame" : "frames"}
                        </summary>
                        <ol class="divide-border border-border divide-y border-t">
                          {#each group.frames as { frame, index: frameIndex } (frameIndex)}
                            {@render frameRow(index, frame, frameIndex)}
                          {/each}
                        </ol>
                      </details>
                    </li>
                  {:else}
                    {#each group.frames as { frame, index: frameIndex } (frameIndex)}
                      {@render frameRow(index, frame, frameIndex)}
                    {/each}
                  {/if}
                {/each}
              </ol>
            {/if}
          </div>
        {/each}

        {#if data.source}
          <p class="text-text-subtle text-xs">
            Source links point at commit
            <span class="font-mono">{data.source.commit.slice(0, 7)}</span>
            of {data.source.repoUrl}.
          </p>
        {/if}
      </div>
    </section>

    <div class="grid gap-6 lg:grid-cols-2">
      {#if payload.request || payload.user}
        <section class="panel space-y-3 rounded-md p-4">
          {#if payload.request}
            <div>
              <h3 class="eyebrow mb-1">Request</h3>
              <p class="text-text font-mono text-xs break-all">
                {payload.request.method ?? ""} {payload.request.url ?? ""}
              </p>
            </div>
          {/if}
          {#if payload.user}
            <div>
              <h3 class="eyebrow mb-1">User</h3>
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                {#each Object.entries(payload.user).filter(([, value]) => value) as [key, value] (key)}
                  <dt class="text-text-subtle">{key}</dt>
                  <dd class="text-text font-mono break-all">{value}</dd>
                {/each}
              </dl>
            </div>
          {/if}
        </section>
      {/if}

      {#if payload.tags.length > 0 || payload.serverName || payload.sdk}
        <section class="panel rounded-md p-4">
          <h3 class="eyebrow mb-2">Tags</h3>
          <div class="flex flex-wrap gap-1.5">
            {#each [...payload.tags, ...(payload.serverName ? [["server_name", payload.serverName]] : []), ...(payload.sdk ? [["sdk", payload.sdk]] : [])] as [key, value], tagIndex (tagIndex)}
              <span class="border-border bg-surface-2 inline-flex max-w-full rounded-sm border px-1.5 py-0.5 font-mono text-[0.6875rem]">
                <span class="text-text-subtle shrink-0">{key}:</span>
                <span class="text-text ml-1 truncate">{value}</span>
              </span>
            {/each}
          </div>
        </section>
      {/if}
    </div>

    {#if payload.breadcrumbs.length > 0}
      <section class="panel rounded-md">
        <h3 class="eyebrow border-border border-b px-4 py-3">Breadcrumbs</h3>
        <ol class="divide-border divide-y">
          {#each payload.breadcrumbs.toReversed() as crumb, crumbIndex (crumbIndex)}
            <li class="flex flex-wrap gap-x-3 gap-y-0.5 px-4 py-2 text-xs">
              <span class="text-text-subtle w-16 shrink-0 font-mono">
                {crumb.timestamp ? new Date(crumb.timestamp).toLocaleTimeString() : ""}
              </span>
              <span class="text-text-muted w-24 shrink-0 truncate">{crumb.category ?? crumb.type ?? ""}</span>
              <span class="text-text min-w-0 flex-1 font-mono break-all">{crumb.message ?? ""}</span>
            </li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if Object.keys(payload.contexts).length > 0}
      <section class="panel rounded-md p-4">
        <h3 class="eyebrow mb-2">Contexts</h3>
        <div class="grid gap-3 md:grid-cols-2">
          {#each Object.entries(payload.contexts) as [name, context] (name)}
            <div class="min-w-0">
              <p class="text-text-subtle mb-1 text-xs">{name}</p>
              <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                {#each Object.entries(context) as [key, value] (key)}
                  <dt class="text-text-subtle">{key}</dt>
                  <dd class="text-text font-mono break-all">{typeof value === "object" ? JSON.stringify(value) : String(value)}</dd>
                {/each}
              </dl>
            </div>
          {/each}
        </div>
      </section>
    {/if}

    <p class="text-text-subtle font-mono text-xs break-all">event {payload.eventId}</p>
  {/if}
</div>
