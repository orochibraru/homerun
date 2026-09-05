<script lang="ts">
	import { CloudUpload, Gauge, RefreshCw } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { resolve } from "$app/paths";
	import EmptyState from "$lib/components/empty-state.svelte";
	import { title } from "$lib/store/title";

	const { data } = $props();

	onMount(() => title.set("Scheduling"));

	function formatDate(value: Date | string | null): string {
		if (!value) {
			return "never";
		}
		return new Date(value).toLocaleString();
	}
</script>

<div class="p-6 md:p-8">
  <div class="mb-8">
    <h1 class="text-text text-xl font-semibold tracking-tight">Scheduling</h1>
    <p class="text-text-muted mt-1 text-sm">
      Cron redeploys, backups, and autoscale activity across every service and
      volume, in one place.
    </p>
  </div>

  <div class="space-y-8">
    <!-- ═══ Cron redeploys ═══ -->
    <section>
      <div class="mb-3 flex items-center gap-2">
        <RefreshCw class="text-accent size-4" />
        <h2 class="eyebrow">Cron redeploys</h2>
      </div>
      {#if data.cronServices.length === 0}
        <EmptyState
          icon={RefreshCw}
          subtitle="Turn on scheduled redeploys from a service's Settings tab."
          title="No services have cron redeploy enabled"
        />
      {:else}
        <div class="space-y-2.5">
          {#each data.cronServices as { projectName, service } (service.id)}
            <a
              class="glass hover:border-accent/40 flex items-center gap-4 rounded-2xl p-4 transition-colors"
              href="{resolve('/services')}/{service.id}/settings"
            >
              <div class="min-w-0 flex-1">
                <p class="text-text truncate text-sm font-semibold">
                  {service.name}
                  {#if projectName}
                    <span class="text-text-muted font-normal">· {projectName}</span>
                  {/if}
                </p>
                <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
                  {service.cronSchedule}
                </p>
              </div>
              <p class="text-text-subtle shrink-0 text-xs">
                last run: {formatDate(service.cronLastRunAt)}
              </p>
            </a>
          {/each}
        </div>
      {/if}
    </section>

    <!-- ═══ Backups ═══ -->
    <section>
      <div class="mb-3 flex items-center gap-2">
        <CloudUpload class="text-accent size-4" />
        <h2 class="eyebrow">Backups</h2>
      </div>
      {#if data.backupVolumes.length === 0}
        <EmptyState
          icon={CloudUpload}
          subtitle="Configure an S3 destination and schedule from a volume's page."
          title="No volumes have scheduled backups enabled"
        />
      {:else}
        <div class="space-y-2.5">
          {#each data.backupVolumes as vol (vol.id)}
            <a
              class="glass hover:border-accent/40 flex items-center gap-4 rounded-2xl p-4 transition-colors"
              href="{resolve('/storage')}/{vol.id}"
            >
              <div class="min-w-0 flex-1">
                <p class="text-text truncate text-sm font-semibold">
                  {vol.name}
                </p>
                <p class="text-text-muted mt-0.5 truncate font-mono text-xs">
                  {vol.backupSchedule}
                  · {vol.destinationName}
                </p>
              </div>
              <p class="text-text-subtle shrink-0 text-xs">
                last run: {formatDate(vol.backupLastRunAt)}
              </p>
            </a>
          {/each}
        </div>
      {/if}
    </section>

    <!-- ═══ Autoscaling ═══ -->
    {#if data.isAdmin}
      <section>
        <div class="mb-3 flex items-center gap-2">
          <Gauge class="text-accent size-4" />
          <h2 class="eyebrow">Autoscaling</h2>
        </div>
        {#if !data.autoscale?.autoscaleEnabled}
          <EmptyState
            icon={Gauge}
            subtitle="Turn it on and pick an overflow remote host from Settings."
            title="Autoscaling is off for this instance"
          />
        {:else}
          <p class="text-text-muted mb-3 text-xs">
            Migrates one eligible service to <span class="text-text font-medium"
              >{data.autoscale.overflowHostName ?? "no overflow host configured"}</span>
            when the local host crosses {data.autoscale.autoscaleCpuThresholdPercent}%
            CPU or {data.autoscale.autoscaleMemoryThresholdPercent}% memory.
          </p>
          {#if data.autoscaleServices.length === 0}
            <EmptyState
              icon={Gauge}
              subtitle="Opt a service in from its Compute tab."
              title="No services are autoscale-eligible"
            />
          {:else}
            <div class="space-y-2.5">
              {#each data.autoscaleServices as { hostName, projectName, service } (service.id)}
                <a
                  class="glass hover:border-accent/40 flex items-center gap-4 rounded-2xl p-4 transition-colors"
                  href="{resolve('/services')}/{service.id}/compute"
                >
                  <div class="min-w-0 flex-1">
                    <p class="text-text truncate text-sm font-semibold">
                      {service.name}
                      {#if projectName}
                        <span class="text-text-muted font-normal">· {projectName}</span>
                      {/if}
                    </p>
                  </div>
                  <p class="text-text-subtle shrink-0 text-xs">
                    running on: {hostName}
                  </p>
                </a>
              {/each}
            </div>
          {/if}
        {/if}
      </section>
    {/if}
  </div>
</div>
