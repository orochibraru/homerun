<script lang="ts">
	import type { ImageScanFinding } from "$lib/image-scan";
	import { SEVERITY_CLASS } from "./severity-class";

	interface Props {
		scan: {
			findings: ImageScanFinding[];
			imageRef: string;
			totalFindings: number;
		};
	}

	const { scan }: Props = $props();
</script>

<section>
  <h2 class="eyebrow mb-3">
    Findings
    <span class="text-text-muted ml-1 text-xs font-normal">
      ({scan.totalFindings}{scan.totalFindings > scan.findings.length
      ? `, top ${scan.findings.length} shown`
      : ""})
    </span>
  </h2>
  {#if scan.findings.length === 0}
    <div class="border-border/70 rounded-md border border-dashed py-16 text-center">
      <p class="text-text-muted text-sm">No known vulnerabilities in {scan.imageRef}.</p>
    </div>
  {:else}
    <div class="panel overflow-x-auto rounded-md">
      <table class="w-full min-w-3xl text-sm">
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
          {#each scan.findings as finding (`${finding.id}|${finding.pkg}|${finding.installedVersion}`)}
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
