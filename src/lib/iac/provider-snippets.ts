import { PROVIDER_SOURCE } from "#lib/iac/generate.js";

export interface ProviderSnippet {
	code: string;
	description: string;
	id: string;
	language: "shellscript" | "typescript";
	title: string;
}

/** The Provider tab's how-to, with this instance's URL filled in. */
export function providerSnippets(origin: string): ProviderSnippet[] {
	return [
		{
			code: [
				`export HOMERUN_ENDPOINT=${origin}`,
				"export HOMERUN_API_KEY=<an API key from Profile → Authorized Clients>",
				"export TF_HTTP_PASSWORD=$HOMERUN_API_KEY",
				"terraform init",
				"terraform plan",
			].join("\n"),
			description: `The provider is on the Terraform and OpenTofu registries as ${PROVIDER_SOURCE}, so terraform init (or tofu init) downloads it. It reads its endpoint and key from these variables when the provider block doesn't set them, and the http state backend takes the same key as its password. A project from the Generate tab already has the provider and backend blocks, in providers.tf and versions.tf.`,
			id: "run",
			language: "shellscript",
			title: "Terraform or OpenTofu",
		},
		{
			code: [
				`pulumi package add terraform-provider ${PROVIDER_SOURCE}`,
				`pulumi config set homerun:endpoint ${origin}`,
				"pulumi config set --secret homerun:apiKey <an API key>",
			].join("\n"),
			description:
				"Pulumi (3.147 or later) runs any Terraform provider: pulumi package add downloads it from the registry, generates a typed SDK and records it under packages in Pulumi.yaml. Config keys are camelCase.",
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
