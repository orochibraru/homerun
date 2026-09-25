<script lang="ts">
	import { enhance } from "$app/forms";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { enhanceToast } from "$lib/toast";

	interface Props {
		baseDomain: string;
		settings: { cloudflareZoneId: string | null };
	}

	const { baseDomain, settings }: Props = $props();
</script>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Cloudflare</h2>
      <p class="text-text-muted text-xs">
        Auto-creates a DNS record for every deployed service's
        <code>&lt;slug&gt;.{baseDomain}</code>
        hostname. Unset : no-op, add records by hand as before.
      </p>
    </div>
    <form
      action="?/updateCloudflare"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving Cloudflare settings",
        success: (data) =>
          data?.cloudflareTestOk
            ? `Zone access verified: ${data.cloudflareTestDetail ?? "token accepted"}.`
            : "Cloudflare settings saved.",
      })}
    >
      <div>
        <label class={label} for="cloudflareZoneId">Zone ID</label>
        <Input
          class=""
          id="cloudflareZoneId"
          name="cloudflareZoneId"
          type="text"
          value={settings.cloudflareZoneId ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The zone your base domain lives in, found on that domain's
          Cloudflare dashboard overview page.
        </p>
      </div>
      <div>
        <label class={label} for="cloudflareApiToken">API token</label>
        <Input
          id="cloudflareApiToken"
          name="cloudflareApiToken"
          placeholder={settings.cloudflareZoneId
          ? "Unchanged"
          : "Zone / DNS / Edit permission"}
          type="password"
        />
      </div>
      <div class="flex justify-end gap-2">
        <Button formaction="?/testCloudflare" type="submit" variant="outline">
          Test connection
        </Button>
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>
