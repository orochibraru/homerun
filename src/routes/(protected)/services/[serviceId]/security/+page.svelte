<script lang="ts">
	import {
		Check,
		CheckCircle2,
		LockKeyhole,
		ScanSearch,
		ShieldCheck,
		XCircle,
	} from "@lucide/svelte";
	import { onMount, untrack } from "svelte";
	import { enhance } from "$app/forms";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { Textarea } from "$lib/components/ui/textarea/index.js";
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

	const { data, form } = $props();
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

	let submittingAuth = $state(false);
	let authRequired = $state(untrack(() => svc.authRequired));
	let methods = $state<string[]>(untrack(() => [...svc.authProviders]));
	let allowedUserIds = $state<string[]>(
		untrack(() => [...svc.authAllowedUserIds]),
	);

	$effect(() => {
		authRequired = svc.authRequired;
		methods = [...svc.authProviders];
		allowedUserIds = [...svc.authAllowedUserIds];
	});

	function toggleMethod(method: string, checked: boolean) {
		methods = checked
			? [...new Set([...methods, method])]
			: methods.filter((entry) => entry !== method);
	}

	function toggleUser(userId: string, checked: boolean) {
		allowedUserIds = checked
			? [...new Set([...allowedUserIds, userId])]
			: allowedUserIds.filter((entry) => entry !== userId);
	}
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border flex items-center gap-3 border-b px-5 py-4">
      <div class="bg-accent/10 text-accent flex size-8 items-center justify-center rounded-lg">
        <LockKeyhole class="size-4" />
      </div>
      <div>
        <h2 class="eyebrow">Login wall</h2>
        <p class="text-text-muted text-xs">
          {#if svc.authRequired}
            Visitors are sent to this instance's sign-in page before they reach
            this app.
          {:else}
            Open to anyone who can reach it.
          {/if}
        </p>
      </div>
    </div>

    {#if !svc.dnsResolvable}
      <p class="text-text-muted p-5 text-sm">
        Not applicable : this service isn't publicly routed, so it has no
        Traefik router to gate. Turn on DNS resolvability on the
        <a
          class="text-accent underline"
          href={resolve("/(protected)/services/[serviceId]/networking", {
            serviceId: svc.id,
          })}
        >Networking</a>
        tab first.
      </p>
    {:else}
      <form
        action="?/updateAppAuth"
        class="space-y-4 p-5"
        method="POST"
        use:enhance={enhanceToast({
          error: "Couldn't save the access rules.",
          loading: "Saving access rules",
          onSettled: () => {
            submittingAuth = false;
          },
          onStart: () => {
            submittingAuth = true;
          },
          success: "Access rules saved.",
        })}
      >
        {#if form?.authError}
          <p class="text-xs text-red-500">{form.authError}</p>
        {/if}

        <CheckBox
          helperText="Send anonymous visitors to Homerun's sign-in page instead of letting them through"
          id="authRequired"
          label="Require login to access this app"
          name="authRequired"
          bind:checked={authRequired}
        />

        {#if authRequired}
          {#if !data.dashboardOrigin}
            <p class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
              Set Origin under Settings → General first. The login wall
              redirects visitors to this instance's own sign-in page, so
              Homerun has to know its own public URL to send them there.
            </p>
          {/if}

          <div class="border-border border-t pt-4">
            <p class={label}>Sign-in methods</p>
            <p class="text-text-subtle mb-2 text-xs">
              Nothing is enabled by default. Pick every method someone may use
              to get into this app.
            </p>
            <div class="space-y-2">
              <CheckBox
                checked={methods.includes("password")}
                helperText="Homerun's own email and password accounts"
                id="method-password"
                label="Built-in Homerun login"
                name="method-password"
                onCheckedChange={(v) => toggleMethod("password", v)}
              />
              {#each data.oauthProviders as provider (provider.method)}
                <CheckBox
                  checked={methods.includes(provider.method)}
                  helperText="OAuth / OIDC provider configured under Authentication"
                  id="method-{provider.name}"
                  label={provider.label}
                  name="method-{provider.name}"
                  onCheckedChange={(v) => toggleMethod(provider.method, v)}
                />
              {/each}
              {#if data.oauthProviders.length === 0}
                <p class="text-text-subtle text-xs">
                  No OAuth provider is enabled yet. Add one on the
                  <a class="text-accent" href={resolve("/authentication")}>
                    Authentication
                  </a>
                  page to offer it here.
                </p>
              {/if}
            </div>
            {#each methods as method (method)}
              <input name="authProvider" type="hidden" value={method}>
            {/each}
          </div>

          <div class="border-border border-t pt-4">
            <p class={label}>Who's allowed</p>
            <p class="text-text-subtle mb-3 text-xs">
              Leave all three empty to let any signed-in user through, as long
              as they used one of the methods above. Filling any of them
              narrows access to whoever matches at least one entry in that
              list.
            </p>

            <div class="space-y-3">
              <div>
                <p class="text-text mb-1.5 text-xs font-medium">Users</p>
                <div class="max-h-40 space-y-1.5 overflow-y-auto">
                  {#each data.users as u (u.id)}
                    <CheckBox
                      checked={allowedUserIds.includes(u.id)}
                      helperText={u.email}
                      id="user-{u.id}"
                      label={u.name}
                      name="user-{u.id}"
                      onCheckedChange={(v) => toggleUser(u.id, v)}
                    />
                  {/each}
                </div>
                {#each allowedUserIds as userId (userId)}
                  <input name="authAllowedUserId" type="hidden" value={userId}>
                {/each}
              </div>

              <div>
                <label class={label} for="authAllowedEmails">Emails</label>
                <Textarea
                  class=""
                  id="authAllowedEmails"
                  name="authAllowedEmails"
                  placeholder={"ada@example.com\n*@example.com"}
                  rows={3}
                  value={svc.authAllowedEmails.join("\n")}
                />
                <p class="text-text-subtle mt-1.5 text-xs">
                  One per line. A
                  <span class="">*@domain.com</span>
                  entry matches every address at that domain.
                </p>
              </div>

              <div>
                <label class={label} for="authAllowedGroups">
                  Groups / roles
                </label>
                <Textarea
                  class=""
                  id="authAllowedGroups"
                  name="authAllowedGroups"
                  placeholder={"platform-team\nadmins"}
                  rows={3}
                  value={svc.authAllowedGroups.join("\n")}
                />
                <p class="text-text-subtle mt-1.5 text-xs">
                  One per line, matched against the group and role claims in
                  the id token your OAuth provider issued
                  (<span class="">groups</span>,
                  <span class="">roles</span>, and Keycloak's realm and
                  resource roles). Make sure the provider's scopes actually
                  request them.
                </p>
              </div>
            </div>
          </div>
        {/if}

        <div class="flex flex-wrap items-center gap-3">
          <Button disabled={submittingAuth} type="submit" variant="outline">
            {#if submittingAuth}
              <Spinner />
            {:else}
              <Check class="size-4" />
            {/if}
            Save
          </Button>
        </div>
      </form>
    {/if}
  </section>

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
