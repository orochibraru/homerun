<script lang="ts">
	import { Package } from "@lucide/svelte";
	import CopyButton from "#lib/components/copy-button.svelte";
	import PanelHeader from "#lib/components/panel-header.svelte";
	import { PROVIDER_SOURCE } from "#lib/iac/generate.js";

	const { data } = $props();

	const snippets = $derived([
		{
			code: [
				"git clone https://github.com/orochibraru/homerun.git",
				"cd homerun/terraform/provider",
				"go build -o ~/.local/share/terraform-provider-homerun/terraform-provider-homerun .",
			].join("\n"),
			description:
				"It isn't on the Terraform Registry. Build it from the repository with Go, or download the homerun-terraform-provider binary for your platform from a release and name it terraform-provider-homerun.",
			id: "build",
			title: "1. Build or download the provider",
		},
		{
			code: [
				"provider_installation {",
				"  dev_overrides {",
				`    "${PROVIDER_SOURCE}" = "/home/you/.local/share/terraform-provider-homerun"`,
				"  }",
				"  direct {}",
				"}",
			].join("\n"),
			description:
				"In ~/.terraformrc (OpenTofu reads the same file), point the provider's address at the directory holding the binary. With dev_overrides, skip terraform init's provider download: plan and apply use the binary directly. For a pinned version instead, put it in a filesystem mirror at ~/.terraform.d/plugins/registry.terraform.io/orochibraru/homerun/<version>/<os>_<arch>/terraform-provider-homerun_v<version>.",
			id: "terraformrc",
			title: "2. Tell Terraform where it is",
		},
		{
			code: [
				`export HOMERUN_ENDPOINT=${data.origin}`,
				"export HOMERUN_API_KEY=<an API key from Profile → API keys>",
				"export TF_HTTP_PASSWORD=$HOMERUN_API_KEY",
				"terraform init",
				"terraform plan",
			].join("\n"),
			description:
				"The provider reads its endpoint and key from these variables when the provider block doesn't set them, and the http state backend takes the same key as its password. The Generate tab's main.tf already has the provider and backend blocks.",
			id: "run",
			title: "3. Run it",
		},
		{
			code: [
				"pulumi package add terraform-provider /home/you/.local/share/terraform-provider-homerun/terraform-provider-homerun",
				`pulumi config set homerun:endpoint ${data.origin}`,
				"pulumi config set --secret homerun:apiKey <an API key>",
			].join("\n"),
			description:
				"Pulumi (3.147 or later) runs any Terraform provider: pulumi package add generates a typed SDK from the binary and records it under packages in Pulumi.yaml. Config keys are camelCase.",
			id: "pulumi",
			title: "Pulumi",
		},
		{
			code: [
				'import * as homerun from "@pulumi/homerun";',
				"",
				'const web = new homerun.Stack("web", { name: "Web", slug: "web" });',
				"",
				'const postgres = homerun.getTemplateOutput({ name: "PostgreSQL" });',
				'const db = new homerun.Service("db", {',
				"  stackId: web.id,",
				"  templateId: postgres.id,",
				'  slug: "web-db",',
				"});",
				"",
				'new homerun.Service("api", {',
				'  name: "API",',
				'  slug: "api",',
				"  stackId: web.id,",
				'  image: "ghcr.io/acme/api",',
				'  tag: "1.4.0",',
				"  containerPort: 8080,",
				"  envVars: { DATABASE_HOST: db.slug },",
				"  deployOnChange: true,",
				"});",
			].join("\n"),
			description:
				"Every homerun_ resource is a class (homerun_service is Service), its attributes in camelCase, data sources as get functions.",
			id: "pulumi-ts",
			title: "Pulumi in TypeScript",
		},
	]);
</script>

<div class="space-y-5">
  <section class="panel rounded-md">
    <PanelHeader
      description={`Source address ${PROVIDER_SOURCE}. Resources cover stacks, services and every setting they have, environments, dependencies, volumes and mounts, cron jobs, redirects, notification channels, backup destinations, status pages, DNS connections, git providers, build cache registries, object stores and buckets.`}
      icon={Package}
      title="Terraform provider"
    />
    <div class="divide-border divide-y">
      {#each snippets as snippet (snippet.id)}
        <div class="space-y-2 px-5 py-4">
          <div class="flex items-center justify-between gap-3">
            <h3 class="text-text text-sm font-medium">{snippet.title}</h3>
            <CopyButton label={snippet.title} text="Copy" value={snippet.code} />
          </div>
          <p class="text-text-muted text-xs">{snippet.description}</p>
          <pre class="border-border bg-surface-2 text-text overflow-x-auto rounded-lg border p-3 font-mono text-xs">{snippet.code}</pre>
        </div>
      {/each}
    </div>
  </section>
</div>
