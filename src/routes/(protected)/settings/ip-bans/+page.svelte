<script lang="ts">
	import { ShieldBan } from "@lucide/svelte";
	import CheckBox from "#lib/components/check-box.svelte";
	import { labelClass as label } from "#lib/components/form-styles.js";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import SaveButton from "#lib/components/save-button.svelte";
	import { Input } from "#lib/components/ui/input/index.js";
	import { enhanceToast } from "#lib/toast.js";
	import { enhance } from "$app/forms";
	import { resolve } from "$app/paths";

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

  <p class="text-text-muted text-sm">
    The banned addresses, with an Unban button each, and the ones being
    counted towards a ban are under
    <a class="text-accent hover:underline" href={resolve("/(protected)/monitoring/blocked")}>
      Monitoring → Blocked IPs
    </a>.
  </p>
</div>
