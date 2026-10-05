import { PROVIDER_SOURCE } from "#lib/iac/generate.js";

export interface ProviderSnippet {
	code: string;
	description: string;
	id: string;
	language: "hcl" | "shellscript" | "typescript";
	title: string;
}

/** The Provider tab's how-to, step by step, with this instance's URL filled in. */
export function providerSnippets(origin: string): ProviderSnippet[] {
	return [
		{
			code: [
				"git clone https://github.com/orochibraru/homerun.git",
				"cd homerun/terraform/provider",
				"go build -o ~/.local/share/terraform-provider-homerun/terraform-provider-homerun .",
			].join("\n"),
			description:
				"It isn't on the Terraform Registry. Build it from the repository with Go, or download the homerun-terraform-provider binary for your platform from a release and name it terraform-provider-homerun.",
			id: "build",
			language: "shellscript",
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
			language: "hcl",
			title: "2. Tell Terraform where it is",
		},
		{
			code: [
				`export HOMERUN_ENDPOINT=${origin}`,
				"export HOMERUN_API_KEY=<an API key from Profile → API keys>",
				"export TF_HTTP_PASSWORD=$HOMERUN_API_KEY",
				"terraform init",
				"terraform plan",
			].join("\n"),
			description:
				"The provider reads its endpoint and key from these variables when the provider block doesn't set them, and the http state backend takes the same key as its password. A project from the Generate tab already has the provider and backend blocks, in providers.tf and versions.tf.",
			id: "run",
			language: "shellscript",
			title: "3. Run it",
		},
		{
			code: [
				"pulumi package add terraform-provider /home/you/.local/share/terraform-provider-homerun/terraform-provider-homerun",
				`pulumi config set homerun:endpoint ${origin}`,
				"pulumi config set --secret homerun:apiKey <an API key>",
			].join("\n"),
			description:
				"Pulumi (3.147 or later) runs any Terraform provider: pulumi package add generates a typed SDK from the binary and records it under packages in Pulumi.yaml. Config keys are camelCase.",
			id: "pulumi",
			language: "shellscript",
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
			language: "typescript",
			title: "Pulumi in TypeScript",
		},
	];
}
