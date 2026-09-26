<script lang="ts">
	import { Rocket } from "@lucide/svelte";
	import StepPanel from "./step-panel.svelte";
	import type { OnboardingWizard } from "./wizard-state.svelte";

	interface Props {
		hidden: boolean;
		wizard: OnboardingWizard;
	}

	const { hidden, wizard }: Props = $props();

	const dnsSummary = $derived(
		[
			wizard.cloudflareEnabled ? "Cloudflare" : null,
			wizard.pangolinEnabled
				? wizard.pangolinNewtId.trim()
					? "Pangolin (Newt on this host)"
					: "Pangolin"
				: null,
		]
			.filter(Boolean)
			.join(", ") || "Not configured",
	);
</script>

{#snippet reviewRow(term: string, value: string, mono = false)}
  <div
    class="flex items-baseline justify-between gap-4 border-b border-border/60 py-2.5 last:border-0"
  >
    <dt class="text-text-muted shrink-0 text-sm">{term}</dt>
    <dd class="text-text min-w-0 text-right text-sm break-all {mono ? 'text-xs' : ''}">
      {value}
    </dd>
  </div>
{/snippet}

<StepPanel
  description="What this instance will start with. Everything here is editable later from Settings."
  {hidden}
  title="Review"
>
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
    {@render reviewRow("Base domain", wizard.baseDomain || "—")}
    {@render reviewRow("Origin", wizard.originPreview, true)}
    {@render reviewRow(
      "Docker socket",
      wizard.dockerSocketPath || "auto-detected",
      true,
    )}
    {@render reviewRow("Shared network", wizard.dockerNetworkName || "—", true)}
    {@render reviewRow("Traefik entrypoint", wizard.traefikEntrypoint || "—")}
    {@render reviewRow("Cert resolver", wizard.traefikCertResolver || "—")}
    {@render reviewRow(
      "Email",
      wizard.smtpEnabled ? wizard.smtpHost || "—" : "Not configured",
    )}
    {@render reviewRow("DNS automation", dnsSummary)}
  </dl>
</StepPanel>
