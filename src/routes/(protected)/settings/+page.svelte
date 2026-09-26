<script lang="ts">
	import { TriangleAlert } from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { enhance } from "$app/forms";
	import { page } from "$app/state";
	import CheckBox from "$lib/components/check-box.svelte";
	import ConfirmDialog from "$lib/components/confirm-dialog.svelte";
	import { labelClass as label } from "$lib/components/form-styles";
	import { Button } from "$lib/components/ui/button/index.js";
	import { Input } from "$lib/components/ui/input/index.js";
	import {
		SelectContent,
		SelectItem,
		Select as SelectRoot,
		SelectTrigger,
	} from "$lib/components/ui/select/index.js";
	import { getReleaseStatus } from "$lib/remote/self-update.remote";
	import { getSetupStatus } from "$lib/remote/setup.remote";
	import { RESOURCE_KINDS, RESOURCE_LABELS } from "$lib/resource-thresholds";
	import { nextPasskeyRpId, strandedPasskeyCount } from "$lib/security-policy";
	import { enhanceToast, saveToast } from "$lib/toast";

	const { data } = $props();

	const setup = getSetupStatus();

	const CHANNEL_LABELS = {
		canary: "Canary",
		nightly: "Nightly",
		stable: "Stable",
	} as const;
	let updateChannel = $derived(data.settings.updateChannel ?? "stable");
	const issuesByField = $derived(setup.current?.issuesByField ?? {});

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

	let baseDomainInput = $derived(data.settings.baseDomain ?? "");
	let dashboardUrlInput = $derived(
		originIsDerived ? "" : (data.settings.authOrigin ?? ""),
	);
	const nextRpId = $derived(
		nextPasskeyRpId(baseDomainInput, dashboardUrlInput),
	);
	const stranded = $derived(
		strandedPasskeyCount(data.passkeyRpId, nextRpId, data.passkeyCount),
	);
	let strandDialogOpen = $state(false);
	let strandConfirmed = false;
	let coreForm: HTMLFormElement | undefined = $state();

	const saveCore = saveToast("Core settings");
	const guardedSaveCore: SubmitFunction = (input) => {
		if (stranded > 0 && !strandConfirmed) {
			input.cancel();
			strandDialogOpen = true;
			return;
		}
		strandConfirmed = false;
		return saveCore(input);
	};

	const highlighted = $derived(
		new Set(
			(page.url.searchParams.get("highlight") ?? "").split(",").filter(Boolean),
		),
	);
	function highlightClass(field: string): string {
		return highlighted.has(field) ? "ring-2 ring-amber-400" : "";
	}
	function issueFor(field: string): string | undefined {
		return highlighted.has(field) ? issuesByField[field] : undefined;
	}
</script>

<div class="space-y-6">
  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Core</h2>
      <p class="text-text-muted text-xs">
        Base domain and the auth-gate check URL.
      </p>
    </div>
    <form
      bind:this={coreForm}
      action="?/updateCore"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={guardedSaveCore}
    >
      <div>
        <label class={label} for="baseDomain">Base domain</label>
        <Input
          class={highlightClass("baseDomain")}
          id="baseDomain"
          name="baseDomain"
          oninput={(event) => {
            baseDomainInput = event.currentTarget.value;
          }}
          placeholder={data.envDefaults.baseDomain}
          type="text"
          value={data.settings.baseDomain ?? ""}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          A bare hostname, e.g. <code class="">example.com</code>
          or <code class="">app.example.local</code>. Deployed
          services are routed by Traefik under
          <code class="">&lt;slug&gt;.{data.settings.baseDomain ??
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
          class=""
          id="authOrigin"
          name="authOrigin"
          placeholder={derivedOrigin ??
          data.envDefaults.authOrigin ??
          "https://example.com"}
          oninput={(event) => {
            dashboardUrlInput = event.currentTarget.value;
          }}
          type="text"
          value={originIsDerived ? "" : (data.settings.authOrigin ?? "")}
        />
        <p class="text-text-subtle mt-1.5 text-xs">
          Where <em>this dashboard</em> is reached, scheme and port included.
          Leave blank to derive it from the base domain above. It's separate
          from the routing name because the two genuinely differ in
          development, where the dashboard runs on a port
          (<code class="">http://localhost:5173</code>) while
          services are routed by Traefik on 443
          (<code class="">dashy.localhost</code>). Single sign-on
          redirect URIs and the per-app login wall both point here.
        </p>
        {#if stranded > 0}
          <p class="mt-1.5 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
            <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
            <span>
              This moves the dashboard from <code>{data.passkeyRpId}</code> to
              <code>{nextRpId}</code>, which strands
              {stranded === 1 ? "the 1 registered passkey" : `all ${stranded} registered passkeys`}
              on this instance: a passkey only signs in on the hostname it was
              created on. Everyone affected signs in another way and registers a
              new one from Profile → Security.
            </span>
          </p>
        {/if}
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

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Resource limits</h2>
      <p class="text-text-muted text-xs">
        How full the server gets before Homerun says so. Past the soft limit it
        sends a <strong>Resource warning</strong>; past the hard limit it sends
        <strong>Resource critical</strong> and refuses new services until usage
        drops back. Checked once a minute; the GPU counts only on a host that
        has one.
      </p>
    </div>
    <form
      action="?/updateResources"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={saveToast("Resource limits")}
    >
      <div class="grid grid-cols-[auto_1fr_1fr] items-center gap-x-3 gap-y-3 text-sm sm:gap-x-4">
        <span></span>
        <span class={label}>Soft %</span>
        <span class={label}>Hard %</span>
        {#each RESOURCE_KINDS as kind (kind)}
          <span class="text-text">{RESOURCE_LABELS[kind]}</span>
          <Input
            aria-label="{RESOURCE_LABELS[kind]} soft threshold"
            max="100"
            min="1"
            name="{kind}Soft"
            type="number"
            value={data.resourceThresholds[kind].soft}
          />
          <Input
            aria-label="{RESOURCE_LABELS[kind]} hard threshold"
            max="100"
            min="1"
            name="{kind}Hard"
            type="number"
            value={data.resourceThresholds[kind].hard}
          />
        {/each}
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>

  <section class="panel rounded-md">
    <div class="border-border border-b px-5 py-4">
      <h2 class="eyebrow">Release channel</h2>
      <p class="text-text-muted text-xs">Which releases the update notice offers.</p>
    </div>
    <form
      action="?/updateChannel"
      class="space-y-4 p-5"
      method="POST"
      use:enhance={enhanceToast({
        error: "Couldn't change the release channel.",
        loading: "Saving the release channel",
        onComplete: () => getReleaseStatus().refresh(),
        onFailure: () => {
          updateChannel = data.settings.updateChannel ?? "stable";
        },
        success: "Release channel saved.",
      })}
    >
      <div>
        <label class={label} for="updateChannel">Channel</label>
        <SelectRoot name="updateChannel" type="single" bind:value={updateChannel}>
          <SelectTrigger id="updateChannel">{CHANNEL_LABELS[updateChannel]}</SelectTrigger>
          <SelectContent>
            <SelectItem label="Stable" value="stable" />
            <SelectItem label="Canary" value="canary" />
            <SelectItem label="Nightly" value="nightly" />
          </SelectContent>
        </SelectRoot>
        <p class="text-text-subtle mt-1.5 text-xs">
          <strong>Canary</strong> offers every build merged to <code>main</code> once it
          passed the end-to-end tests, ahead of the next stable release.
          <strong>Nightly</strong> offers the same builds before those tests run, so it
          can ship a broken one. Switching to a more stable channel doesn't downgrade:
          updates just stop until that channel has a release newer than the one you run.
        </p>
      </div>
      <div class="flex justify-end">
        <Button type="submit">Save</Button>
      </div>
    </form>
  </section>
</div>

<ConfirmDialog
  bind:open={strandDialogOpen}
  confirmLabel="Save anyway"
  description={`Saving moves the dashboard to ${nextRpId ?? "a new hostname"}. ${stranded === 1 ? "The 1 registered passkey" : `All ${stranded} registered passkeys`} on this instance will stop working, and anyone who relies on one has to sign in another way and register a new passkey.`}
  onConfirm={() => {
    strandConfirmed = true;
    coreForm?.requestSubmit();
  }}
  title="Strand registered passkeys?"
/>
