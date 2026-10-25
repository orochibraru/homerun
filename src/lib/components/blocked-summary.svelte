<script lang="ts">
	import { ChartNoAxesColumn } from "@lucide/svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import type {
		BannedPerService,
		BlockedSummary,
	} from "#lib/dto/blocked-hit-dto.js";
	import { formatBytes } from "#lib/formatting.js";

	interface Props {
		baiting: boolean;
		bans?: number | null;
		days: number;
		summary: BlockedSummary;
		/** The service the most banned addresses were caught on, shown as a fifth stat when set. */
		topService?: BannedPerService | null;
	}

	const {
		baiting,
		bans = null,
		days,
		summary,
		topService = undefined,
	}: Props = $props();

	const plural = (n: number, word: string) =>
		`${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;
</script>

<section class="panel rounded-md">
  <PanelHeader
    description={`Every request a blocked path turned away in the last ${days} days.`}
    icon={ChartNoAxesColumn}
    title="Summary"
  />
  <dl class="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 {topService === undefined ? 'xl:grid-cols-4' : 'xl:grid-cols-5'}">
    <div>
      <dt class="text-text-subtle text-xs">IPs blocked</dt>
      <dd class="text-text mt-1 text-2xl font-semibold tabular-nums">
        {summary.addresses.toLocaleString()}
      </dd>
      <p class="text-text-muted mt-0.5 text-xs">
        {plural(summary.requests, "request")}{bans === null ? "" : ` · ${bans.toLocaleString()} banned now`}
      </p>
    </div>
    <div class="min-w-0">
      <dt class="text-text-subtle text-xs">Most common pattern</dt>
      <dd class="text-text mt-1 truncate font-mono text-2xl font-semibold" title={summary.topPattern?.pattern}>
        {summary.topPattern?.pattern ?? "—"}
      </dd>
      <p class="text-text-muted mt-0.5 text-xs">
        {summary.topPattern
          ? `${plural(summary.topPattern.hits, "hit")}, ${Math.round((summary.topPattern.hits / Math.max(summary.requests, 1)) * 100)}% of them`
          : "Nothing hit a blocked path yet."}
      </p>
    </div>
    <div>
      <dt class="text-text-subtle text-xs">Bullshit served</dt>
      <dd class="text-text mt-1 text-2xl font-semibold tabular-nums">
        {formatBytes(summary.baitBytes)}
      </dd>
      <p class="text-text-muted mt-0.5 text-xs">
        {summary.baitResponses.toLocaleString()}
        {summary.baitResponses === 1 ? "fake file or insult" : "fake files and insults"}
      </p>
    </div>
    {#if topService !== undefined}
      <div class="min-w-0">
        <dt class="text-text-subtle text-xs">Most banned on</dt>
        <dd class="text-text mt-1 truncate text-2xl font-semibold" title={topService?.serviceName}>
          {topService?.serviceName ?? "—"}
        </dd>
        <p class="text-text-muted mt-0.5 text-xs">
          {topService
            ? `${plural(topService.bans, "banned address")} caught there`
            : "No banned address hit a known service."}
        </p>
      </div>
    {/if}
    <div>
      <dt class="text-text-subtle text-xs">Fed bait</dt>
      <dd class="text-text mt-1 text-2xl font-semibold tabular-nums">
        {summary.requests === 0 ? "—" : `${Math.round((summary.baitResponses / summary.requests) * 100)}%`}
      </dd>
      <p class="text-text-muted mt-0.5 text-xs">
        {baiting
          ? "of blocked requests got junk instead of a 403."
          : "Mean and Disrespect mode are off: everyone gets a plain 403."}
      </p>
    </div>
  </dl>
</section>
