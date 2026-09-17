<script lang="ts">
	import {
		CheckCircle2,
		ScanSearch,
		ShieldCheck,
		XCircle,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { timeAgo } from "$lib/formatting";
	import {
		BLOCK_SEVERITY_OPTIONS,
		evaluateScanPolicy,
		SCAN_SEVERITIES,
		type ScanSeverity,
		type SeverityCounts,
	} from "$lib/image-scan";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Security`));

	const POLL_MS = 3000;

	let submitting = $state(false);

	$effect(() => {
		if (!data.scanning) {
			return;
		}
		const timer = setInterval(() => invalidateAll(), POLL_MS);
		return () => clearInterval(timer);
	});

	const SEVERITY_CLASS: Record<ScanSeverity, string> = {
		CRITICAL: "border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400",
		HIGH: "border-orange-500/25 bg-orange-500/10 text-orange-600 dark:text-orange-400",
		LOW: "border-sky-500/25 bg-sky-500/10 text-sky-600 dark:text-sky-400",
		MEDIUM:
			"border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
		UNKNOWN: "border-border bg-surface-2 text-text-muted",
	};

	const latest = $derived(data.scans[0] ?? null);
	const latestOk = $derived(data.scans.find((scan) => scan.status === "ok"));
	const policyLabel = $derived(
		`${
			BLOCK_SEVERITY_OPTIONS.find(
				(option) => option.value === (data.blockPolicy.severity ?? "off"),
			)?.label ?? "Off"
		}${data.blockPolicy.severity && data.blockPolicy.fixableOnly ? ", fixable only" : ""}`,
	);
	const verdict = $derived(
		latestOk ? evaluateScanPolicy(latestOk, data.blockPolicy) : null,
	);
	const deployed = $derived(Boolean(svc.containerId || svc.swarmServiceId));

	function countFor(counts: SeverityCounts, severity: ScanSeverity): number {
		return counts[severity.toLowerCase() as keyof SeverityCounts];
	}
</script>

<div class="space-y-6">
  {#if !data.instanceScanEnabled}
    <Alert title="Image scanning is turned off for this instance." variant="info">
      An admin can turn it back on under
      <a class="text-accent underline" href={resolve("/settings/docker")}>
        Settings → Docker
      </a>.
    </Alert>
  {:else if !svc.imageScanEnabled}
    <Alert title="Image scanning is turned off for this service." variant="info">
      Deploys skip the scan. Turn it back on in the
      <a
        class="text-accent underline"
        href={resolve("/(protected)/services/[serviceId]/settings", {
          serviceId: svc.id,
        })}
      >Settings</a>
      tab.
    </Alert>
  {/if}

  <section class="panel rounded-md">
    <div class="border-border flex flex-wrap items-center justify-between gap-4 border-b px-5 py-4">
      <div class="flex items-center gap-3">
        <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
          <ShieldCheck class="size-4" />
        </div>
        <div>
          <h2 class="eyebrow">Image scan</h2>
          <p class="text-text-muted text-xs">
            Every deploy scans the image with Trivy before the workload starts.
            Block policy: <span class="text-text font-medium">{policyLabel}</span>
            {#if data.isAdmin}
              (<a class="text-accent underline" href={resolve("/settings/docker")}
              >change</a>).
            {:else}
              (set by an admin).
            {/if}
          </p>
        </div>
      </div>
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
          disabled={submitting || data.scanning || !deployed}
          size="sm"
          type="submit"
          variant="outline"
        >
          {#if data.scanning}
            <Spinner />
            Scanning…
          {:else}
            <ScanSearch class="size-3.5" />
            Scan now
          {/if}
        </Button>
      </form>
    </div>

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
        {#if verdict && data.blockPolicy.severity}
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

  {#if latestOk}
    <section>
      <h2 class="eyebrow mb-3">
        Findings
        <span class="text-text-muted ml-1 text-xs font-normal">
          ({latestOk.totalFindings}{latestOk.totalFindings > latestOk.findings.length
          ? `, top ${latestOk.findings.length} shown`
          : ""})
        </span>
      </h2>
      {#if latestOk.findings.length === 0}
        <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
          <p class="text-text-muted text-sm">No known vulnerabilities in {latestOk.imageRef}.</p>
        </div>
      {:else}
        <div class="panel overflow-x-auto rounded-md">
          <table class="w-full text-sm">
            <thead>
              <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
                <th class="px-4 py-3 font-medium">Severity</th>
                <th class="px-4 py-3 font-medium">Vulnerability</th>
                <th class="px-4 py-3 font-medium">Package</th>
                <th class="px-4 py-3 font-medium">Installed</th>
                <th class="px-4 py-3 font-medium">Fixed in</th>
                <th class="px-4 py-3 font-medium">Title</th>
              </tr>
            </thead>
            <tbody>
              {#each latestOk.findings as finding (`${finding.id}|${finding.pkg}|${finding.installedVersion}`)}
                <tr class="border-border/60 border-b last:border-0">
                  <td class="px-4 py-3">
                    <span
                      class="rounded border px-1.5 py-0.5 text-[0.65rem] font-semibold uppercase {SEVERITY_CLASS[finding.severity]}"
                    >
                      {finding.severity}
                    </span>
                  </td>
                  <td class="px-4 py-3 font-mono text-xs whitespace-nowrap">
                    <a
                      class="text-accent hover:underline"
                      href="https://avd.aquasec.com/nvd/{finding.id.toLowerCase()}"
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      {finding.id}
                    </a>
                  </td>
                  <td class="text-text px-4 py-3 font-mono text-xs">{finding.pkg}</td>
                  <td class="text-text-muted px-4 py-3 font-mono text-xs">
                    {finding.installedVersion}
                  </td>
                  <td class="text-text-muted px-4 py-3 font-mono text-xs">
                    {finding.fixedVersion ?? "—"}
                  </td>
                  <td class="text-text-muted px-4 py-3 text-xs">{finding.title ?? ""}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}

  {#if data.scans.length > 1}
    <section>
      <h2 class="eyebrow mb-3">History</h2>
      <div class="panel overflow-x-auto rounded-md">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-border text-text-muted border-b text-left text-xs uppercase">
              <th class="px-4 py-3 font-medium">Scanned</th>
              <th class="px-4 py-3 font-medium">Image</th>
              <th class="px-4 py-3 font-medium">Via</th>
              <th class="px-4 py-3 font-medium">Result</th>
            </tr>
          </thead>
          <tbody>
            {#each data.scans as scan (scan.id)}
              <tr class="border-border/60 border-b last:border-0">
                <td class="text-text-muted px-4 py-3 text-xs whitespace-nowrap">
                  {timeAgo(scan.scannedAt)}
                </td>
                <td class="text-text px-4 py-3 font-mono text-xs break-all">
                  {scan.imageRef}
                </td>
                <td class="text-text-muted px-4 py-3 text-xs">{scan.source}</td>
                <td class="px-4 py-3 text-xs">
                  {#if scan.status === "ok"}
                    <span class="text-text">
                      {scan.counts.critical} critical · {scan.counts.high} high ·
                      {scan.counts.medium} medium
                    </span>
                  {:else if scan.status === "failed"}
                    <span class="text-red-500" title={scan.error ?? ""}>Failed</span>
                  {:else}
                    <span class="text-text-muted" title={scan.error ?? ""}>Skipped</span>
                  {/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
  {/if}
</div>
