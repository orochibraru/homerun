<script lang="ts">
	import type { SubmitFunction } from "@sveltejs/kit";
	import { toast } from "svelte-sonner";
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";

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

	function submitToast(sectionLabel: string): SubmitFunction {
		return () =>
			async ({ result, update }) => {
				if (result.type === "success") {
					toast.success(`${sectionLabel} saved.`);
				} else if (result.type === "failure") {
					toast.error(
						(result.data as { error?: string } | undefined)?.error ??
							"Check the form for errors.",
					);
				}
				await update();
			};
	}
</script>

<section class="border-border bg-surface rounded-2xl border">
  <div class="border-border border-b px-5 py-4">
    <h2 class="text-text text-sm font-semibold">Core</h2>
    <p class="text-text-muted text-xs">
      Base domain and the auth-gate check URL.
    </p>
  </div>
  <form
    action="?/updateCore"
    class="space-y-4 p-5"
    method="POST"
    use:enhance={submitToast("Core settings")}
  >
    <div>
      <label class={label} for="baseDomain">Base domain</label>
      <Input
        class={highlightClass("baseDomain")}
        id="baseDomain"
        name="baseDomain"
        placeholder={data.envDefaults.baseDomain}
        type="text"
        value={data.settings.baseDomain ?? ""}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        A bare hostname, e.g. <code class="font-mono">example.com</code>
        or <code class="font-mono">app.example.local</code> : no
        <code class="font-mono">https://</code>, path, or trailing slash.
        Deployed services are routed under &lt;slug&gt;.&lt;this&gt;, and
        this app's own origin below is derived from it, so this one field
        is all that's needed.
      </p>
      {#if issueFor("baseDomain")}
        <p class="mt-1.5 text-xs text-amber-600 dark:text-amber-400">
          ⚠ {issueFor("baseDomain")}
        </p>
      {/if}
    </div>
    <CheckBox
      checked={data.settings.authOrigin
      ? data.settings.authOrigin.startsWith("https://")
      : true}
      helperText={`Origin: ${
        data.settings.authOrigin ??
        (data.settings.baseDomain
          ? `https://${data.settings.baseDomain}`
          : (data.envDefaults.authOrigin ?? "derived per-request until a base domain is set"))
      }`}
      id="useHttps"
      label="Use HTTPS"
      name="useHttps"
    />
    <div>
      <label class={label} for="authCheckUrl">Auth-check URL</label>
      <Input
        id="authCheckUrl"
        name="authCheckUrl"
        placeholder={data.envDefaults.authCheckUrl}
        type="text"
        value={data.settings.authCheckUrl ?? ""}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        What Traefik's forwardAuth middleware calls to gatekeep a "Require
        login" service : must be reachable from inside the Traefik
        container.
      </p>
    </div>
    <CheckBox
      checked={data.settings.authCrossSubdomainCookies ?? false}
      helperText="Widens the session cookie to every subdomain of the base domain"
      id="authCrossSubdomainCookies"
      label="Cross-subdomain cookies"
      name="authCrossSubdomainCookies"
    />
    <div class="flex justify-end">
      <Button type="submit">Save</Button>
    </div>
  </form>
</section>
