<script lang="ts">
	import { Ban, ShieldBan, Undo2 } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import EmptyState from "#lib/components/empty-state.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Button } from "#lib/components/ui/button/index.js";
	import { Input } from "#lib/components/ui/input/index.js";
	import { formatDate, timeAgo } from "#lib/formatting.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";

	const { data } = $props();

	let saving = $state(false);
	let enabled = $derived(data.ipBans.enabled);
</script>

<div class="space-y-6">
  {#if !data.published}
    <p class="rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-600">
      Traefik's dynamic config directory isn't set (Settings → Networking), so
      blocked requests aren't counted and bans aren't enforced.
    </p>
  {/if}

  <section class="panel rounded-md">
    <PanelHeader
      description="Bans an address that keeps requesting a service's blocked paths, on every service at once. The dashboard's own address is never blocked, so a ban can't lock you out of lifting it."
      icon={ShieldBan}
      title="IP bans"
    >
      {#snippet trailing()}
        <SaveButton form="ip-ban-settings" pending={saving} />
      {/snippet}
    </PanelHeader>
    <form
      id="ip-ban-settings"
      action="?/updateIpBans"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't save the IP ban settings.",
        loading: "Saving IP ban settings",
        onSettled: () => {
          saving = false;
        },
        onStart: () => {
          saving = true;
        },
        success: "IP ban settings saved.",
      })}
    >
      <CheckBox
        helperText="Off still blocks the paths, it only stops counting towards a ban."
        id="enabled"
        label="Ban addresses that keep hitting blocked paths"
        name="enabled"
        bind:checked={enabled}
      />
      <div class="grid gap-4 sm:grid-cols-3">
        <div>
          <label class={label} for="threshold">Blocked requests</label>
          <Input
            id="threshold"
            max="1000"
            min="1"
            name="threshold"
            placeholder={String(data.defaults.threshold)}
            type="number"
            value={data.ipBans.threshold}
          />
        </div>
        <div>
          <label class={label} for="windowMinutes">Within (minutes)</label>
          <Input
            id="windowMinutes"
            max={data.maxWindowMinutes}
            min="1"
            name="windowMinutes"
            placeholder={String(data.defaults.windowMinutes)}
            type="number"
            value={data.ipBans.windowMinutes}
          />
        </div>
        <div>
          <label class={label} for="durationHours">Ban for (hours)</label>
          <Input
            id="durationHours"
            max="8760"
            min="0"
            name="durationHours"
            placeholder={String(data.defaults.durationHours)}
            type="number"
            value={data.ipBans.durationHours}
          />
        </div>
      </div>
      <p class="text-text-subtle text-xs">
        0 hours bans for good. The address is the one Traefik sees the request
        come from: behind a proxy such as Pangolin or Cloudflare that's the
        proxy, so private and loopback addresses and requests through
        Cloudflare are never banned.
      </p>
    </form>
  </section>

  <section class="panel rounded-md">
    <PanelHeader
      description="Addresses Traefik turns away with a 403 on every service."
      icon={Ban}
      title="Banned addresses"
    />
    <div class="p-5">
      {#if data.bans.length === 0}
        <EmptyState
          icon={Ban}
          subtitle="Addresses that keep requesting blocked paths show up here."
          title="Nobody is banned"
        />
      {:else}
        <div class="space-y-2.5">
          {#each data.bans as ban (ban.ip)}
            <div class="border-border flex items-center gap-4 rounded-md border p-4">
              <div class="min-w-0 flex-1">
                <p class="text-text truncate font-mono text-sm font-medium">
                  {ban.ip}
                </p>
                <p class="text-text-muted mt-0.5 truncate text-xs">
                  {ban.reason}{ban.host ? ` on ${ban.host}` : ""}
                </p>
                <p class="text-text-subtle mt-0.5 text-xs">
                  banned {timeAgo(ban.createdAt)} ·
                  {ban.expiresAt
                    ? `until ${formatDate(ban.expiresAt)} ${new Date(ban.expiresAt).toLocaleTimeString()}`
                    : "for good"}
                </p>
              </div>
              <form
                action="?/unban"
                method="POST"
                use:enhance={enhanceToast({
                  error: "Couldn't lift that ban.",
                  loading: `Unbanning ${ban.ip}`,
                  success: `${ban.ip} unbanned.`,
                })}
              >
                <input name="ip" type="hidden" value={ban.ip}>
                <Button size="sm" type="submit" variant="outline">
                  <Undo2 class="size-4" />
                  Unban
                </Button>
              </form>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </section>
</div>
