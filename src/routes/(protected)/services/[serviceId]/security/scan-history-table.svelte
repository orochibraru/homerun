<script lang="ts">
	import { timeAgo } from "$lib/formatting";
	import type { ImageScanStatus, SeverityCounts } from "$lib/image-scan";

	interface Props {
		scans: {
			counts: SeverityCounts;
			error: string | null;
			id: string;
			imageRef: string;
			scannedAt: Date;
			source: string;
			status: ImageScanStatus;
		}[];
	}

	const { scans }: Props = $props();
</script>

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
        {#each scans as scan (scan.id)}
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
