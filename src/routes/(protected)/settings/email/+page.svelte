<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { saveToast } from "$lib/toast";

	const { data } = $props();

	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);
	function highlightClass(field: string): string {
		return highlighted.has(field) ? "ring-2 ring-amber-400" : "";
	}
	function issueFor(field: string): string | undefined {
		return highlighted.has(field) ? data.fieldIssues[field] : undefined;
	}
</script>

<section class="glass rounded-2xl">
  <div class="border-border border-b px-5 py-4">
    <h2 class="eyebrow">Email (SMTP)</h2>
    <p class="text-text-muted text-xs">
      Used for email verification on sign-up.
    </p>
    {#if issueFor("smtpHost")}
      <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
        ⚠ {issueFor("smtpHost")}
      </p>
    {/if}
  </div>
  <form
    action="?/updateSmtp"
    class="space-y-4 p-5"
    method="POST"
    use:enhance={saveToast("SMTP settings")}
  >
    <CheckBox
      checked={data.settings.smtpEnabled ?? false}
      helperText="Send email through this SMTP server"
      id="smtpEnabled"
      label="Enabled"
      name="smtpEnabled"
    />
    <div class="grid gap-4 sm:grid-cols-2">
      <div>
        <label class={label} for="smtpHost">Host</label>
        <Input
          class={highlightClass("smtpHost")}
          id="smtpHost"
          name="smtpHost"
          placeholder={data.envDefaults.smtpHost ?? "smtp.example.com"}
          type="text"
          value={data.settings.smtpHost ?? ""}
        />
      </div>
      <div>
        <label class={label} for="smtpPort">Port</label>
        <Input
          class={highlightClass("smtpPort")}
          id="smtpPort"
          name="smtpPort"
          placeholder={data.envDefaults.smtpPort?.toString() ?? "587"}
          type="text"
          value={data.settings.smtpPort ?? ""}
        />
      </div>
      <div>
        <label class={label} for="smtpUser">Username</label>
        <Input
          class={highlightClass("smtpUser")}
          id="smtpUser"
          name="smtpUser"
          placeholder={data.envDefaults.smtpUser ?? ""}
          type="text"
          value={data.settings.smtpUser ?? ""}
        />
      </div>
      <div>
        <label class={label} for="smtpPassword">Password</label>
        <Input
          class={highlightClass("smtpPassword")}
          id="smtpPassword"
          name="smtpPassword"
          placeholder={data.settings.smtpPasswordEnc
          ? "Leave blank to keep current"
          : "Password"}
          type="password"
        />
      </div>
      <div>
        <label class={label} for="smtpFrom">From address</label>
        <Input
          class={highlightClass("smtpFrom")}
          id="smtpFrom"
          name="smtpFrom"
          placeholder={data.envDefaults.smtpFrom ?? "no-reply@example.com"}
          type="text"
          value={data.settings.smtpFrom ?? ""}
        />
      </div>
      <div class="sm:col-span-2">
        <CheckBox
          checked={data.settings.smtpSecure ?? false}
          helperText="Use TLS when connecting to the SMTP server"
          id="smtpSecure"
          label="Secure (TLS)"
          name="smtpSecure"
        />
      </div>
    </div>
    <div class="flex justify-end">
      <Button type="submit">Save</Button>
    </div>
  </form>
</section>
