<script lang="ts">
	import {
		CheckCircle2,
		ScanSearch,
		ShieldCheck,
		XCircle,
	} from "@lucide/svelte";
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import PanelHeader from "$lib/components/panel-header.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { timeAgo } from "$lib/formatting";
	import {
		BLOCK_SEVERITY_OPTIONS,
		evaluateScanPolicy,
		type ImageScanStatus,
		SCAN_SEVERITIES,
		type ScanBlockPolicy,
		type ScanSeverity,
		type SeverityCounts,
	} from "$lib/image-scan";
	import { enhanceToast } from "$lib/toast";
	import { SEVERITY_CLASS } from "./severity-class";

	interface Scan {
		counts: SeverityCounts;
		error: string | null;
		fixableCounts: SeverityCounts | null;
		imageRef: string;
		scannedAt: Date;
		status: ImageScanStatus;
	}

	interface Props {
		blockPolicy: ScanBlockPolicy;
		deployed: boolean;
		isAdmin: boolean;
		latest: Scan | null;
		latestOk: Scan | undefined;
		scanning: boolean;
	}

	const { blockPolicy, deployed, isAdmin, latest, latestOk, scanning }: Props =
		$props();

	let submitting = $state(false);

	const policyLabel = $derived(
		`${
			BLOCK_SEVERITY_OPTIONS.find(
				(option) => option.value === (blockPolicy.severity ?? "off"),
			)?.label ?? "Off"
		}${blockPolicy.severity && blockPolicy.fixableOnly ? ", fixable only" : ""}`,
	);
	const verdict = $derived(
		latestOk ? evaluateScanPolicy(latestOk, blockPolicy) : null,
	);

	function countFor(counts: SeverityCounts, severity: ScanSeverity): number {
		return counts[severity.toLowerCase() as keyof SeverityCounts];
	}
</script>

<section class="panel rounded-md">
  <PanelHeader class="flex-wrap" icon={ShieldCheck} title="Image scan">
    {#snippet description()}
      Every deploy scans the image with Trivy before the workload starts.
      Block policy: <span class="text-text font-medium">{policyLabel}</span>
      {#if isAdmin}
        (<a class="text-accent underline" href={resolve("/settings/docker")}
        >change</a>).
      {:else}
        (set by an admin).
      {/if}
    {/snippet}
    {#snippet trailing()}
      <form
        action="?/scan"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't queue the scan.",
          loading: "Queueing a scan",
          onComplete: () => invalidateAll(),
          onSettled: () => {
            submitting = false;
          },
          onStart: () => {
            submitting = true;
          },
          success: "Scan queued.",
        })}
      >
        <Button
          disabled={submitting || scanning || !deployed}
          size="sm"
          type="submit"
          variant="outline"
        >
          {#if scanning}
            <Spinner />
            Scanning…
          {:else}
            <ScanSearch class="size-3.5" />
            Scan now
          {/if}
        </Button>
      </form>
    {/snippet}
  </PanelHeader>

  {#if latest}
    <div class="space-y-4 p-5">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        {#if latest.status === "ok"}
          <span class="flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 class="size-3.5" />
            Scanned
          </span>
        {:else if latest.status === "failed"}
          <span class="flex items-center gap-1 text-xs text-red-500">
            <XCircle class="size-3.5" />
            Scan failed
          </span>
        {:else}
          <span class="text-text-muted text-xs">Skipped</span>
        {/if}
        <span class="text-text font-mono text-xs break-all">{latest.imageRef}</span>
        <span class="text-text-subtle text-xs">{timeAgo(latest.scannedAt)}</span>
      </div>
      {#if latest.error}
        <p class="text-text-muted text-xs">{latest.error}</p>
      {/if}
      {#if verdict && blockPolicy.severity}
        {#if verdict.blocked}
          <Alert title="The latest scan fails the block policy." variant="error">
            A deploy of this image would fail. {verdict.reason}
          </Alert>
        {:else}
          <Alert title="The latest scan passes the block policy." variant="success" />
        {/if}
      {/if}
      {#if latestOk}
        <div class="flex flex-wrap gap-2">
          {#each SCAN_SEVERITIES as severity (severity)}
            <span
              class="rounded-md border px-2.5 py-1 text-xs font-medium {SEVERITY_CLASS[severity]}"
            >
              {countFor(latestOk.counts, severity)}
              {severity.toLowerCase()}
            </span>
          {/each}
        </div>
      {/if}
    </div>
  {:else}
    <div class="p-5">
      <EmptyState
        icon={ShieldCheck}
        subtitle={deployed
        ? "The next deploy scans the image, or run a scan now."
        : "The first deploy scans the image."}
        title="No scans yet"
      />
    </div>
  {/if}
</section>
