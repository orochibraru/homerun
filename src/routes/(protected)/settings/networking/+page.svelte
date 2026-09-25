<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { getSetupStatus } from "$lib/remote/setup.remote";
	import { enhanceToast } from "$lib/toast";

	const { data } = $props();

	const setup = getSetupStatus();
	const dynamicDirIssue = $derived(
		(page.url.searchParams.get("highlight") ?? "")
			.split(",")
			.includes("traefikDynamicConfigDir")
			? setup.current?.issuesByField.traefikDynamicConfigDir
			: undefined,
	);
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Traefik</h2>
      <p class="text-text-muted text-xs">
        Entrypoint, cert resolver, ACME account email, and the custom-SSL
        dynamic-config directory.
      </p>
    </div>
    <form
      action="?/updateTraefik"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving Traefik settings",
        success: (data) =>
          (data?.traefikDetail as string | null) ?? "Traefik settings saved.",
      })}
    >
      <div>
        <label class={label} for="traefikAcmeEmail">ACME account email</label>
        <Input
          id="traefikAcmeEmail"
          name="traefikAcmeEmail"
          placeholder={data.envDefaults.traefikAcmeEmail ?? "admin@example.com"}
          type="email"
          value={data.settings.traefikAcmeEmail ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          The contact address Traefik registers with Let's Encrypt. Traefik
          only reads it at startup, so saving a <em>new</em> one here
          rewrites
          <code class="">--certificatesresolvers.&lt;resolver&gt;.acme.email</code>
          on the running container and recreates it : expect a few seconds of
          downtime, and this page may blink if you reach it through Traefik.
          Saving the value it already has changes nothing.
        </p>
      </div>
      <div>
        <label class={label} for="traefikEntrypoint">Entrypoint</label>
        <Input
          id="traefikEntrypoint"
          name="traefikEntrypoint"
          placeholder={data.envDefaults.traefikEntrypoint}
          type="text"
          value={data.settings.traefikEntrypoint ?? ""}
        />
      </div>
      <div>
        <label class={label} for="traefikCertResolver">Cert resolver</label>
        <Input
          id="traefikCertResolver"
          name="traefikCertResolver"
          placeholder={data.envDefaults.traefikCertResolver}
          type="text"
          value={data.settings.traefikCertResolver ?? ""}
        />
      </div>
      <div>
        <label class={label} for="traefikDynamicConfigDir"
        >Dynamic config directory</label>
        <Input
          class={dynamicDirIssue ? "ring-2 ring-amber-400" : ""}
          id="traefikDynamicConfigDir"
          name="traefikDynamicConfigDir"
          placeholder={data.envDefaults.traefikDynamicConfigDir
          ?? "unset : custom SSL is a no-op"}
          type="text"
          value={data.settings.traefikDynamicConfigDir ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          Must match the path bind-mounted into the Traefik container : see
          compose.yaml's commented-out example. Unset means per-service custom
          SSL certs are stored but never written anywhere.
        </p>
        {#if dynamicDirIssue}
          <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
            ⚠ {dynamicDirIssue}
          </p>
        {/if}
      </div>
      <CheckBox
        checked={data.settings.traefikHttpCache}
        helperText="Loads the Souin cache plugin into Traefik (downloaded on its next start), so services can turn on Cache responses on their Networking tab. Nothing is cached until a service does."
        id="traefikHttpCache"
        label="HTTP cache"
        name="traefikHttpCache"
      />
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

</div>
