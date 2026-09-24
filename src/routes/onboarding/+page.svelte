<script lang="ts">
	import {
		Cpu,
		Globe,
		Mail,
		Network,
		Rocket,
		Server,
		TriangleAlert,
	} from "@lucide/svelte";
	import type { SubmitFunction } from "@sveltejs/kit";
	import { onMount } from "svelte";
	import { enhance } from "$app/forms";
	import BrandMark from "$lib/components/brand-mark.svelte";
	import Stepper, { type StepperStep } from "$lib/components/stepper.svelte";
	import { Button } from "$lib/components/ui/button/index.js";
	import Spinner from "$lib/components/ui/spinner/spinner.svelte";
	import { ONBOARDING_FIELD_STEP } from "$lib/onboarding-fields";
	import { title } from "$lib/store/title";
	import { enhanceToast } from "$lib/toast";
	import CoreStep from "./core-step.svelte";
	import DnsStep from "./dns-step.svelte";
	import DockerStep from "./docker-step.svelte";
	import EmailStep from "./email-step.svelte";
	import ReviewStep from "./review-step.svelte";
	import { testConnection } from "./test-connection";
	import TraefikStep from "./traefik-step.svelte";
	import { type FieldErrors, OnboardingWizard } from "./wizard-state.svelte";

	const { data, form } = $props();

	onMount(() => title.set("Set up Homerun"));

	const wizard = new OnboardingWizard(() => ({ data, form }));

	const STEPS: StepperStep[] = [
		{ icon: Globe, label: "Core" },
		{ icon: Server, label: "Docker" },
		{ icon: Cpu, label: "Traefik" },
		{ icon: Mail, label: "Email" },
		{ icon: Network, label: "DNS" },
		{ label: "Review" },
	];

	let activeStep = $state(0);
	let submitting = $state(false);

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

	// Index-aligned with STEPS (minus the fields-less Review step).
	const STEP_FIELDS: string[][] = [
		["baseDomain"],
		["dockerSocketPath", "dockerNetworkName"],
		["traefikEntrypoint", "traefikCertResolver"],
		["smtpHost", "smtpPort", "smtpUser", "smtpFrom"],
		[
			"cloudflareZoneId",
			"cloudflareApiToken",
			"pangolinApiBaseUrl",
			"pangolinOrgId",
			"pangolinMainSiteName",
			"pangolinApiToken",
			"pangolinNewtEndpoint",
			"pangolinNewtId",
			"pangolinNewtSecret",
		],
	];
	const STEP_VALIDATORS = [
		() => wizard.validateCore(),
		() => wizard.validateDocker(),
		() => wizard.validateTraefik(),
		() => wizard.validateSmtp(),
		() => wizard.validateDns(),
	];

	const finishToast = enhanceToast({
		error: "Check the form for errors.",
		loading: "Saving your setup",
		onFailure: (failure) => {
			applyServerErrors(
				(failure as { errors?: Record<string, string[]> } | undefined)?.errors,
			);
		},
		onSettled: () => {
			submitting = false;
		},
		onStart: () => {
			submitting = true;
		},
		success: "Setup complete.",
	});

	const submitWizard: SubmitFunction = (input) =>
		input.action.search.includes("/test")
			? testConnection(input)
			: finishToast(input);

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
      use:enhance={submitWizard}
    >
      <Stepper onNext={validateStep} steps={STEPS} bind:activeStep>
        <CoreStep hidden={activeStep !== 0} {showError} {wizard} />
        <DockerStep hidden={activeStep !== 1} {showError} {wizard} />
        <TraefikStep hidden={activeStep !== 2} {showError} {wizard} />
        <EmailStep hidden={activeStep !== 3} {showError} {wizard} />
        <DnsStep hidden={activeStep !== 4} {showError} {wizard} />
        <ReviewStep hidden={activeStep !== 5} {wizard} />

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
