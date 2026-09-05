<script lang="ts">
	import {
		Cpu,
		Globe,
		LoaderIcon,
		Mail,
		Server,
		TriangleAlert,
	} from "@lucide/svelte";
	import type { ActionResult } from "@sveltejs/kit";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import CheckBox from "$lib/components/check-box.svelte";
	import {
		errorClass,
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import Stepper, { type StepperStep } from "$lib/components/stepper.svelte";
	import { ONBOARDING_FIELD_STEP } from "$lib/onboarding-fields";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Set up Homerun"));

	const STEPS: StepperStep[] = [
		{ icon: Globe, label: "Core" },
		{ icon: Server, label: "Docker" },
		{ icon: Cpu, label: "Traefik" },
		{ icon: Mail, label: "Email" },
		{ label: "Review" },
	];

	let activeStep = $state(0);
	let submitting = $state(false);

	// Every field pre-fills with the *effective* current value (DB override,
	// falling back to the env default) : "required" is then trivially
	// satisfied by just clicking through if the defaults are already fine.
	const { settings, envDefaults } = $derived(data);

	let baseDomain = $derived(
		(form?.values?.baseDomain as string | undefined) ??
			settings?.baseDomain ??
			envDefaults?.baseDomain ??
			"",
	);
	// Origin isn't a separate typed field, same derivation as the Settings
	// page's Core section : base domain plus this checkbox, so onboarding
	// only ever asks for one domain, not two URLs.
	let useHttps = $derived(
		settings?.authOrigin ? settings.authOrigin.startsWith("https://") : true,
	);
	const originPreview = $derived(
		`${useHttps ? "https" : "http"}://${baseDomain || "…"}`,
	);
	let authCrossSubdomainCookies = $derived(
		settings?.authCrossSubdomainCookies ?? false,
	);

	// Deliberately *not* pre-filled from envDefaults, unlike every other
	// field on this page : real, tested-in-review bug this replaced.
	// envDefaults.dockerSocketPath is now live-detected (see $lib/config.ts's
	// detectDockerSocketPath), so pre-filling the bound value with it would
	// make finishing onboarding persist *that moment's* detected path as a
	// permanent DB override the instant you click through, even having
	// never touched the field, silently shadowing any future improvement to
	// what auto-detection resolves to (verified live in a real dev DB : an
	// onboarding-persisted stale "/var/run/docker.sock" kept winning over a
	// newly-fixed detector forever, `override ?? envDefaults` always
	// preferring the override). Blank stays blank unless a stored DB
	// override or a just-failed submission's own value says otherwise;
	// envDefaults only shows as the input's `placeholder` below now.
	let dockerSocketPath = $derived(
		(form?.values?.dockerSocketPath as string | undefined) ??
			settings?.dockerSocketPath ??
			"",
	);
	let dockerNetworkName = $derived(
		(form?.values?.dockerNetworkName as string | undefined) ??
			settings?.dockerNetworkName ??
			envDefaults?.dockerNetworkName ??
			"",
	);

	let traefikEntrypoint = $derived(
		(form?.values?.traefikEntrypoint as string | undefined) ??
			settings?.traefikEntrypoint ??
			envDefaults?.traefikEntrypoint ??
			"",
	);
	let traefikCertResolver = $derived(
		(form?.values?.traefikCertResolver as string | undefined) ??
			settings?.traefikCertResolver ??
			envDefaults?.traefikCertResolver ??
			"",
	);
	let traefikDynamicConfigDir = $derived(
		(form?.values?.traefikDynamicConfigDir as string | undefined) ??
			settings?.traefikDynamicConfigDir ??
			envDefaults?.traefikDynamicConfigDir ??
			"",
	);

	let smtpEnabled = $derived(
		settings?.smtpEnabled ?? envDefaults?.smtpEnabled ?? false,
	);
	let smtpHost = $derived(
		(form?.values?.smtpHost as string | undefined) ??
			settings?.smtpHost ??
			envDefaults?.smtpHost ??
			"",
	);
	let smtpPort = $derived(
		(form?.values?.smtpPort as string | undefined) ??
			settings?.smtpPort?.toString() ??
			envDefaults?.smtpPort?.toString() ??
			"",
	);
	let smtpUser = $derived(
		(form?.values?.smtpUser as string | undefined) ??
			settings?.smtpUser ??
			envDefaults?.smtpUser ??
			"",
	);
	let smtpPassword = $state("");
	let smtpFrom = $derived(
		(form?.values?.smtpFrom as string | undefined) ??
			settings?.smtpFrom ??
			envDefaults?.smtpFrom ??
			"",
	);
	let smtpSecure = $derived(
		settings?.smtpSecure ?? envDefaults?.smtpSecure ?? false,
	);

	type FieldErrors = Record<string, string>;
	let errors = $state<FieldErrors>({});
	let attempted = $state<Set<number>>(new Set());

	function showError(field: string): string | undefined {
		return attempted.has(ONBOARDING_FIELD_STEP[field] ?? 0)
			? errors[field]
			: undefined;
	}

	function setStepErrors(fields: string[], next: FieldErrors) {
		const merged = { ...errors };
		for (const f of fields) {
			delete merged[f];
		}
		Object.assign(merged, next);
		errors = merged;
	}

	function validateCore(): FieldErrors {
		const next: FieldErrors = {};
		if (!baseDomain.trim()) {
			next.baseDomain = "Base domain is required.";
		}
		return next;
	}

	// Both fields are optional now (blank = use the effective default, see
	// dockerSocketPath's own comment above), nothing left to validate here :
	// kept as a function, rather than dropped from STEP_VALIDATORS, so a
	// future required Docker-step field has an obvious place to land.
	function validateDocker(): FieldErrors {
		return {};
	}

	function validateTraefik(): FieldErrors {
		const next: FieldErrors = {};
		if (!traefikEntrypoint.trim()) {
			next.traefikEntrypoint = "Entrypoint is required.";
		}
		if (!traefikCertResolver.trim()) {
			next.traefikCertResolver = "Cert resolver is required.";
		}
		return next;
	}

	function validateSmtp(): FieldErrors {
		const next: FieldErrors = {};
		if (!smtpEnabled) {
			return next;
		}
		if (!smtpHost.trim()) {
			next.smtpHost = "Host is required when SMTP is enabled.";
		}
		if (!smtpPort.trim()) {
			next.smtpPort = "Port is required when SMTP is enabled.";
		}
		if (!smtpUser.trim()) {
			next.smtpUser = "Username is required when SMTP is enabled.";
		}
		if (!smtpFrom.trim()) {
			next.smtpFrom = "From address is required when SMTP is enabled.";
		}
		return next;
	}

	// Index-aligned with STEPS (minus the fields-less Review step).
	const STEP_FIELDS: string[][] = [
		["baseDomain"],
		["dockerSocketPath", "dockerNetworkName"],
		["traefikEntrypoint", "traefikCertResolver"],
		["smtpHost", "smtpPort", "smtpUser", "smtpFrom"],
	];
	const STEP_VALIDATORS = [
		validateCore,
		validateDocker,
		validateTraefik,
		validateSmtp,
	];

	function validateStep(step: number): boolean {
		attempted.add(step);
		attempted = new Set(attempted);

		const next = STEP_VALIDATORS[step]?.() ?? {};
		setStepErrors(STEP_FIELDS[step] ?? [], next);
		return Object.keys(next).length === 0;
	}

	function validateAll(): boolean {
		let ok = true;
		for (let i = 0; i < STEPS.length - 1; i += 1) {
			if (!validateStep(i)) {
				ok = false;
			}
		}
		return ok;
	}

	/** Maps a fail()'d field-error map back onto local state : jumps to the first offending step, same idea as services/new's simpler "jump to step 0" but to the actual step. */
	function applyServerErrors(failErrors: Record<string, string[]> | undefined) {
		if (!failErrors) {
			return;
		}
		const flat: FieldErrors = {};
		for (const [field, msgs] of Object.entries(failErrors)) {
			if (msgs?.[0]) {
				flat[field] = msgs[0];
			}
		}
		errors = { ...errors, ...flat };
		for (const field of Object.keys(flat)) {
			attempted.add(ONBOARDING_FIELD_STEP[field] ?? 0);
		}
		attempted = new Set(attempted);
		const [firstField] = Object.keys(flat);
		if (firstField) {
			activeStep = ONBOARDING_FIELD_STEP[firstField] ?? 0;
		}
	}
</script>

{#if data.waitingForAdmin}
  <div class="flex min-h-screen items-center justify-center p-6">
    <div class="text-center">
      <TriangleAlert class="mx-auto mb-4 size-8 text-amber-500" />
      <h1 class="text-text text-xl font-semibold tracking-tight">Almost there</h1>
      <p class="mt-2 text-sm text-text-muted">
        An admin needs to finish setting up this instance before you can
        continue. Check back shortly.
      </p>
    </div>
  </div>
{:else}
  <div class="mx-auto space-y-6 p-6 md:p-10">
    <div>
      <h1 class="text-text text-xl font-semibold tracking-tight">Set up Homerun</h1>
      <p class="mt-0.5 text-sm text-text-muted">
        A few instance-wide settings before the dashboard unlocks : every field
        below is also editable later from Settings.
      </p>
    </div>

    {#if data.authSecretIsDefault}
      <div class="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
        <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
        <span>
          Still using the built-in placeholder auth secret : this can't be fixed
          from this wizard. Set <code>AUTH_SECRET</code> (e.g.
          <code>openssl rand -base64 32</code>) and restart when you get a
          chance.
        </span>
      </div>
    {/if}

    <form
      action="?/finish"
      method="POST"
      use:enhance={enhanceToast({
        error: "Check the form for errors.",
        loading: "Saving your setup",
        onFailure: (data) => {
          applyServerErrors(
            (data as { errors?: Record<string, string[]> } | undefined)?.errors,
          );
        },
        onSettled: () => {
          submitting = false;
        },
        onStart: () => {
          submitting = true;
        },
        success: "Setup complete.",
      })}
    >
      <Stepper onNext={validateStep} steps={STEPS} bind:activeStep>
        {#snippet children()}
          <!-- ═══ Step 1: Core ═══ -->
          <section
            class="space-y-4 rounded-2xl glass p-5"
            class:hidden={activeStep !== 0}
          >
            <div>
              <label class={label} for="baseDomain">Base domain</label>
              <input
                class={input}
                id="baseDomain"
                name="baseDomain"
                type="text"
                bind:value={baseDomain}
              >
              <p class="mt-1.5 text-xs text-text-subtle">
                Deployed services are routed under &lt;slug&gt;.&lt;this&gt;.
              </p>
              {#if showError("baseDomain")}
                <p class={errorClass}>{showError("baseDomain")}</p>
              {/if}
            </div>
            <CheckBox
              helperText={`Origin: ${originPreview}`}
              id="useHttps"
              label="Use HTTPS"
              name="useHttps"
              bind:checked={useHttps}
            />
            <CheckBox
              helperText="Widens the session cookie to every subdomain of the base domain"
              id="authCrossSubdomainCookies"
              label="Cross-subdomain cookies"
              name="authCrossSubdomainCookies"
              bind:checked={authCrossSubdomainCookies}
            />
          </section>

          <!-- ═══ Step 2: Docker ═══ -->
          <section
            class="space-y-4 rounded-2xl glass p-5"
            class:hidden={activeStep !== 1}
          >
            <div>
              <label class={label} for="dockerSocketPath">Socket path</label>
              <input
                class="{input} font-mono"
                id="dockerSocketPath"
                name="dockerSocketPath"
                placeholder={envDefaults?.dockerSocketPath}
                type="text"
                bind:value={dockerSocketPath}
              >
              <p class="mt-1.5 text-xs text-text-subtle">
                Leave blank to keep auto-detecting this (shown above as a
                placeholder) : only set it here to pin a specific path.
              </p>
              {#if showError("dockerSocketPath")}
                <p class={errorClass}>{showError("dockerSocketPath")}</p>
              {/if}
            </div>
            <div>
              <label class={label} for="dockerNetworkName"
              >Shared network name</label>
              <input
                class="{input} font-mono"
                id="dockerNetworkName"
                name="dockerNetworkName"
                type="text"
                bind:value={dockerNetworkName}
              >
              {#if showError("dockerNetworkName")}
                <p class={errorClass}>{showError("dockerNetworkName")}</p>
              {/if}
            </div>
          </section>

          <!-- ═══ Step 3: Traefik ═══ -->
          <section
            class="space-y-4 rounded-2xl glass p-5"
            class:hidden={activeStep !== 2}
          >
            <div>
              <label class={label} for="traefikEntrypoint">Entrypoint</label>
              <input
                class={input}
                id="traefikEntrypoint"
                name="traefikEntrypoint"
                type="text"
                bind:value={traefikEntrypoint}
              >
              {#if showError("traefikEntrypoint")}
                <p class={errorClass}>{showError("traefikEntrypoint")}</p>
              {/if}
            </div>
            <div>
              <label class={label} for="traefikCertResolver"
              >Cert resolver</label>
              <input
                class={input}
                id="traefikCertResolver"
                name="traefikCertResolver"
                type="text"
                bind:value={traefikCertResolver}
              >
              {#if showError("traefikCertResolver")}
                <p class={errorClass}>{showError("traefikCertResolver")}</p>
              {/if}
            </div>
            <div>
              <label class={label} for="traefikDynamicConfigDir"
              >Dynamic config directory (optional)</label>
              <input
                class="{input} font-mono"
                id="traefikDynamicConfigDir"
                name="traefikDynamicConfigDir"
                placeholder="unset : custom SSL is a no-op"
                type="text"
                bind:value={traefikDynamicConfigDir}
              >
            </div>
          </section>

          <!-- ═══ Step 4: Email ═══ -->
          <section
            class="space-y-4 rounded-2xl glass p-5"
            class:hidden={activeStep !== 3}
          >
            <CheckBox
              helperText="Send email through this SMTP server"
              id="smtpEnabled"
              label="Enabled"
              name="smtpEnabled"
              bind:checked={smtpEnabled}
            />
            {#if smtpEnabled}
              <div class="grid gap-4 sm:grid-cols-2">
                <div>
                  <label class={label} for="smtpHost">Host</label>
                  <input
                    class={input}
                    id="smtpHost"
                    name="smtpHost"
                    type="text"
                    bind:value={smtpHost}
                  >
                  {#if showError("smtpHost")}
                    <p class={errorClass}>{showError("smtpHost")}</p>
                  {/if}
                </div>
                <div>
                  <label class={label} for="smtpPort">Port</label>
                  <input
                    class={input}
                    id="smtpPort"
                    name="smtpPort"
                    type="text"
                    bind:value={smtpPort}
                  >
                  {#if showError("smtpPort")}
                    <p class={errorClass}>{showError("smtpPort")}</p>
                  {/if}
                </div>
                <div>
                  <label class={label} for="smtpUser">Username</label>
                  <input
                    class={input}
                    id="smtpUser"
                    name="smtpUser"
                    type="text"
                    bind:value={smtpUser}
                  >
                  {#if showError("smtpUser")}
                    <p class={errorClass}>{showError("smtpUser")}</p>
                  {/if}
                </div>
                <div>
                  <label class={label} for="smtpPassword">Password</label>
                  <input
                    class={input}
                    id="smtpPassword"
                    name="smtpPassword"
                    placeholder={settings?.smtpPasswordEnc
                    ? "Leave blank to keep current"
                    : "Password"}
                    type="password"
                    bind:value={smtpPassword}
                  >
                </div>
                <div>
                  <label class={label} for="smtpFrom">From address</label>
                  <input
                    class={input}
                    id="smtpFrom"
                    name="smtpFrom"
                    type="text"
                    bind:value={smtpFrom}
                  >
                  {#if showError("smtpFrom")}
                    <p class={errorClass}>{showError("smtpFrom")}</p>
                  {/if}
                </div>
                <div class="sm:col-span-2">
                  <CheckBox
                    helperText="Use TLS when connecting to the SMTP server"
                    id="smtpSecure"
                    label="Secure (TLS)"
                    name="smtpSecure"
                    bind:checked={smtpSecure}
                  />
                </div>
              </div>
            {:else}
              <p class="text-xs text-text-subtle">
                Skippable : email verification just won't send until this is
                configured, here or later on Settings.
              </p>
            {/if}
          </section>

          <!-- ═══ Step 5: Review ═══ -->
          <section
            class="space-y-3 rounded-2xl glass p-5"
            class:hidden={activeStep !== 4}
          >
            <h2 class="eyebrow">Ready to go</h2>
            <dl class="space-y-1.5 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-text-muted">Base domain</dt>
                <dd class="truncate text-text">{baseDomain || "—"}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-text-muted">Docker socket</dt>
                <dd class="truncate font-mono text-xs text-text">
                  {dockerSocketPath || "auto-detected"}
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-text-muted">Traefik entrypoint</dt>
                <dd class="truncate text-text">{traefikEntrypoint || "—"}</dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-text-muted">Email</dt>
                <dd class="truncate text-text">
                  {smtpEnabled ? smtpHost || "—" : "Not configured"}
                </dd>
              </div>
            </dl>
            <p class="text-xs text-text-subtle">
              Everything here can be changed later from Settings.
            </p>
          </section>
        {/snippet}

        {#snippet finish()}
          <button
            class="bg-accent shadow-accent/30 hover:bg-accent-dark flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-all disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {#if submitting}
              <LoaderIcon class="size-4 animate-spin" />
              Finishing…
            {:else}
              Finish setup
            {/if}
          </button>
        {/snippet}
      </Stepper>
    </form>
  </div>
{/if}
