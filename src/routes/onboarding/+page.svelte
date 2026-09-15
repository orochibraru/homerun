<script lang="ts">
	import {
		Check,
		Cpu,
		Globe,
		Mail,
		Minus,
		Rocket,
		Server,
		TriangleAlert,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import AsyncBlock from "$lib/components/async-block.svelte";
	import BrandMark from "$lib/components/brand-mark.svelte";
	import CheckBox from "$lib/components/check-box.svelte";
	import {
		errorClass,
		inputClass as input,
		labelClass as label,
	} from "$lib/components/form-styles";
	import Skeleton from "$lib/components/skeleton.svelte";
	import Stepper, { type StepperStep } from "$lib/components/stepper.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { ONBOARDING_FIELD_STEP } from "$lib/onboarding-fields";
	import { getSwarmReadiness } from "$lib/remote/setup.remote";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";

	const { data, form } = $props();

	onMount(() => title.set("Set up Homerun"));

	/** The `:port` an origin carries, when the base domain itself doesn't : onboarding asks for one hostname, and this is how the port survives it. */
	function originPort(origin: string | null, domain: string): string {
		if (!origin || domain.includes(":")) {
			return "";
		}
		try {
			const { port } = new URL(origin);
			return port ? `:${port}` : "";
		} catch {
			return "";
		}
	}

	const swarm = getSwarmReadiness();

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

	// The effective origin : a stored override, else the ORIGIN env var the
	// installer and compose.prod.yaml both set. Everything about this step is
	// prefilled from it rather than from baseDomain alone, because baseDomain
	// is deliberately portless (it's a Traefik Host() rule, see CLAUDE.md)
	// while an installer instance is reached at http://<ip>:3000. Prefilling
	// from the portless value and re-deriving the origin from it is how
	// clicking Next on the defaults used to overwrite a correct ORIGIN with a
	// port-80 URL.
	const effectiveOrigin = $derived(
		settings?.authOrigin ?? envDefaults?.authOrigin ?? null,
	);
	const originHost = $derived.by(() => {
		if (!effectiveOrigin) {
			return null;
		}
		try {
			return new URL(effectiveOrigin).host;
		} catch {
			return null;
		}
	});
	let baseDomain = $derived(
		(form?.values?.baseDomain as string | undefined) ??
			(settings?.baseDomain
				? `${settings.baseDomain}${originPort(effectiveOrigin, settings.baseDomain)}`
				: null) ??
			originHost ??
			envDefaults?.baseDomain ??
			"",
	);
	// Origin isn't a separate typed field, same derivation as the Settings
	// page's Core section : base domain plus this checkbox, so onboarding
	// only ever asks for one domain, not two URLs.
	let useHttps = $derived(
		effectiveOrigin ? effectiveOrigin.startsWith("https://") : true,
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

{#snippet swarmCheck(ok: boolean, yes: string, no: string)}
  <li class="flex items-start gap-2">
    {#if ok}
      <Check class="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
      <span>{yes}</span>
    {:else}
      <Minus class="text-text-subtle mt-0.5 size-3.5 shrink-0" />
      <span>{no}</span>
    {/if}
  </li>
{/snippet}

{#snippet panelHeader(label: string, description: string)}
  <div class="border-b border-border pb-4">
    <h2 class="text-text text-base font-semibold tracking-tight">{label}</h2>
    <p class="text-text-muted mt-1 text-sm">{description}</p>
  </div>
{/snippet}

{#snippet reviewRow(term: string, value: string, mono = false)}
  <div
    class="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0"
  >
    <dt class="text-text-muted text-sm">{term}</dt>
    <dd class="text-text truncate text-sm {mono ? 'text-xs' : ''}">
      {value}
    </dd>
  </div>
{/snippet}

{#if data.waitingForAdmin}
  <div class="flex min-h-screen flex-col items-center justify-center p-6">
    <BrandMark class="mb-10" size="lg" />
    <div class="panel w-full max-w-md rounded-md p-8 text-center">
      <div
        class="mx-auto mb-5 flex size-12 items-center justify-center rounded-md bg-amber-500/10 text-amber-500"
      >
        <TriangleAlert class="size-6" />
      </div>
      <h1 class="text-text text-lg font-semibold tracking-tight">
        Almost there
      </h1>
      <p class="text-text-muted mt-2 text-sm leading-relaxed">
        An admin needs to finish setting up this instance before you can
        continue. Check back shortly.
      </p>
    </div>
  </div>
{:else}
  <div class="mx-auto w-full max-w-3xl p-6 md:p-10">
    <BrandMark class="mb-9" size="lg" />

    <div class="mb-8">
      <p class="eyebrow mb-2">Setup</p>
      <h1 class="text-text text-2xl font-semibold tracking-tight md:text-3xl">
        Let's get this instance running
      </h1>
      <p class="text-text-muted mt-2 max-w-xl text-sm leading-relaxed">
        A few instance-wide settings before the dashboard unlocks : every field
        below is also editable later from Settings.
      </p>
    </div>

    {#if data.authSecretIsDefault}
      <div
        class="mb-8 flex items-start gap-2.5 rounded-md border border-red-500/30 bg-red-500/5 p-3.5 text-xs text-red-600 dark:text-red-400"
      >
        <TriangleAlert class="mt-0.5 size-3.5 shrink-0" />
        <span>
          Still using the built-in placeholder auth secret : this can't be fixed
          from this wizard. Set <code class="">AUTH_SECRET</code> (e.g.
          <code class="">openssl rand -base64 32</code>) and restart
          when you get a chance.
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
            class="space-y-5 rounded-md panel p-6"
            class:hidden={activeStep !== 0}
          >
            {@render panelHeader(
              "Core",
              "The domain this instance and everything it deploys lives under.",
            )}
            <div>
              <label class={label} for="baseDomain">Base domain</label>
              <input
                class={input}
                id="baseDomain"
                name="baseDomain"
                placeholder="example.com"
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
            class="space-y-5 rounded-md panel p-6"
            class:hidden={activeStep !== 1}
          >
            {@render panelHeader(
              "Docker",
              "How Homerun reaches the daemon it deploys onto.",
            )}
            <div>
              <label class={label} for="dockerSocketPath">Socket path</label>
              <input
                class="{input}"
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
                class="{input}"
                id="dockerNetworkName"
                name="dockerNetworkName"
                type="text"
                bind:value={dockerNetworkName}
              >
              {#if showError("dockerNetworkName")}
                <p class={errorClass}>{showError("dockerNetworkName")}</p>
              {/if}
            </div>

            <AsyncBlock errorTitle="Couldn't check this host's swarm state." query={swarm}>
              {#snippet pending()}
                <Skeleton class="h-16 w-full" />
              {/snippet}
              {#snippet children(readiness)}
                {@const ready =
                  readiness.swarmActive &&
                  readiness.overlayReady &&
                  readiness.traefikSwarmProvider}
                <div
                  class="rounded-md border p-3 text-xs {ready
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-border bg-surface-2'}"
                >
                  <p class="text-text font-medium">
                    Swarm mode {ready ? "is ready on this host" : "isn't set up"}
                  </p>
                  <ul class="text-text-muted mt-2 space-y-1">
                    {@render swarmCheck(
                      readiness.swarmActive,
                      "This daemon is a swarm manager",
                      "docker swarm init hasn't been run here",
                    )}
                    {@render swarmCheck(
                      readiness.overlayReady,
                      `Overlay network ${readiness.network} exists`,
                      `Overlay network ${readiness.network} is missing`,
                    )}
                    {@render swarmCheck(
                      readiness.traefikSwarmProvider,
                      "Traefik runs its swarm provider",
                      readiness.traefikFound
                        ? "Traefik's swarm provider is off"
                        : "No Traefik container found on this host",
                    )}
                  </ul>
                  <p class="text-text-subtle mt-2">
                    Standalone containers don't need any of this. Switching to
                    swarm later from Settings → Docker sets up whatever's
                    missing above.
                  </p>
                </div>
              {/snippet}
            </AsyncBlock>
          </section>

          <!-- ═══ Step 3: Traefik ═══ -->
          <section
            class="space-y-5 rounded-md panel p-6"
            class:hidden={activeStep !== 2}
          >
            {@render panelHeader(
              "Traefik",
              "The router that puts your services on the internet, with certificates.",
            )}
            <div class="grid gap-5 sm:grid-cols-2">
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
            </div>
            <div>
              <label class={label} for="traefikDynamicConfigDir"
              >Dynamic config directory (optional)</label>
              <input
                class="{input}"
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
            class="space-y-5 rounded-md panel p-6"
            class:hidden={activeStep !== 3}
          >
            {@render panelHeader(
              "Email",
              "Optional : used for verification links and invitations.",
            )}
            <CheckBox
              helperText="Send email through this SMTP server"
              id="smtpEnabled"
              label="Enabled"
              name="smtpEnabled"
              bind:checked={smtpEnabled}
            />
            {#if smtpEnabled}
              <div class="grid gap-5 sm:grid-cols-2">
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
            class="space-y-5 rounded-md panel p-6"
            class:hidden={activeStep !== 4}
          >
            {@render panelHeader(
              "Review",
              "What this instance will start with. Everything here is editable later from Settings.",
            )}
            <div
              class="flex items-center gap-3 rounded-md border border-accent/25 bg-accent-light p-4"
            >
              <span
                class="bg-accent/15 text-accent flex size-9 shrink-0 items-center justify-center rounded-md"
              >
                <Rocket class="size-4.5" />
              </span>
              <div class="min-w-0">
                <p class="text-text text-sm font-medium">Ready to go</p>
                <p class="text-text-muted text-xs">
                  Finishing unlocks the dashboard for this instance.
                </p>
              </div>
            </div>
            <dl>
              {@render reviewRow("Base domain", baseDomain || "—")}
              {@render reviewRow("Origin", originPreview, true)}
              {@render reviewRow(
                "Docker socket",
                dockerSocketPath || "auto-detected",
                true,
              )}
              {@render reviewRow(
                "Shared network",
                dockerNetworkName || "—",
                true,
              )}
              {@render reviewRow(
                "Traefik entrypoint",
                traefikEntrypoint || "—",
              )}
              {@render reviewRow("Cert resolver", traefikCertResolver || "—")}
              {@render reviewRow(
                "Email",
                smtpEnabled ? smtpHost || "—" : "Not configured",
              )}
            </dl>
          </section>
        {/snippet}

        {#snippet finish()}
          <Button disabled={submitting} type="submit">
            {#if submitting}
              <Spinner />
              Finishing…
            {:else}
              <Rocket class="size-4" />
              Finish setup
            {/if}
          </Button>
        {/snippet}
      </Stepper>
    </form>
  </div>
{/if}
