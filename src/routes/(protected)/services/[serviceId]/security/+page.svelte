<script lang="ts">
	import { onMount } from "svelte";
	import { invalidateAll } from "$app/navigation";
	import { resolve } from "$app/paths";
	import Alert from "$lib/components/alert.svelte";
	import { title } from "$lib/store/title";
	import FindingsTable from "./findings-table.svelte";
	import LoginWallSection from "./login-wall-section.svelte";
	import ScanHistoryTable from "./scan-history-table.svelte";
	import ScanPanel from "./scan-panel.svelte";

	const { data, form } = $props();
	const svc = $derived(data.service);

	onMount(() => title.set(`${svc.name} · Security`));

	const POLL_MS = 3000;

	$effect(() => {
		if (!data.scanning) {
			return;
		}
		const timer = setInterval(() => invalidateAll(), POLL_MS);
		return () => clearInterval(timer);
	});

	const latest = $derived(data.scans[0] ?? null);
	const latestOk = $derived(data.scans.find((scan) => scan.status === "ok"));
	const deployed = $derived(Boolean(svc.containerId || svc.swarmServiceId));
</script>

<div class="space-y-6">
  <LoginWallSection
    authError={form?.authError}
    dashboardOrigin={data.dashboardOrigin}
    emailSignIn={data.emailSignIn}
    oauthProviders={data.oauthProviders}
    {svc}
    users={data.users}
  />

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

  <ScanPanel
    blockPolicy={data.blockPolicy}
    {deployed}
    isAdmin={data.isAdmin}
    {latest}
    {latestOk}
    scanning={data.scanning}
  />

  {#if latestOk}
    <FindingsTable scan={latestOk} />
  {/if}

  {#if data.scans.length > 1}
    <ScanHistoryTable scans={data.scans} />
  {/if}
</div>
