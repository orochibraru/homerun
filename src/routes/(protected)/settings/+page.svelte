<script lang="ts">
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import { saveToast } from "$lib/toast";

	const { data } = $props();

	const derivedOrigin = $derived(
		data.settings.baseDomain
			? `${
					data.settings.authOrigin?.startsWith("http://") ? "http" : "https"
				}://${data.settings.baseDomain}`
			: null,
	);
	const originIsDerived = $derived(
		!data.settings.authOrigin ||
			(!!data.settings.baseDomain &&
				(data.settings.authOrigin === `https://${data.settings.baseDomain}` ||
					data.settings.authOrigin === `http://${data.settings.baseDomain}`)),
	);

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
    <h2 class="eyebrow">Core</h2>
    <p class="text-text-muted text-xs">
      Base domain and the auth-gate check URL.
    </p>
  </div>
  <form
    action="?/updateCore"
    class="space-y-4 p-5"
    method="POST"
    use:enhance={saveToast("Core settings")}
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
        or <code class="font-mono">app.example.local</code>. Deployed
        services are routed by Traefik under
        <code class="font-mono">&lt;slug&gt;.{data.settings.baseDomain ??
        data.envDefaults.baseDomain}</code>, so a port here is never part of
        that : add one only if this dashboard is reached on a port, and it
        moves to the Dashboard URL below instead of the routing name.
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
      <label class={label} for="authOrigin">Dashboard URL</label>
      <Input
        class="font-mono"
        id="authOrigin"
        name="authOrigin"
        placeholder={derivedOrigin ??
        data.envDefaults.authOrigin ??
        "https://example.com"}
        type="text"
        value={originIsDerived ? "" : (data.settings.authOrigin ?? "")}
      />
      <p class="text-text-subtle mt-1.5 text-xs">
        Where <em>this dashboard</em> is reached, scheme and port included.
        Leave blank to derive it from the base domain above. It's separate
        from the routing name because the two genuinely differ in
        development, where the dashboard runs on a port
        (<code class="font-mono">http://localhost:5173</code>) while
        services are routed by Traefik on 443
        (<code class="font-mono">dashy.localhost</code>). Single sign-on
        redirect URIs and the per-app login wall both point here.
      </p>
    </div>
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
