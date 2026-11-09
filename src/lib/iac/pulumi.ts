import { SECRET_MASK } from "#lib/formatting.js";
import {
	compareInstances,
	type DriftReport,
	type StateInstance,
} from "#lib/iac/drift.js";
import {
	configuredAttributes,
	type GeneratedFile,
	type Inventory,
	type LiveObject,
	localNames,
	PROVIDER_SOURCE,
	type RenderContext,
	type SecretVariable,
} from "#lib/iac/generate.js";
import { expression, type HclValue, isExpression } from "#lib/iac/hcl.js";
import {
	IAC_RESOURCES,
	type IacAttribute,
	type IacResource,
	importIdOf,
} from "#lib/iac/resources.js";

/** The npm package `pulumi package add terraform-provider` generates for the provider. */
export const PULUMI_PACKAGE = "@pulumi/homerun";

const ENCRYPTED_VALUE_SIGNATURE = "4dabf18193072939515e22adb298388d";
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const INDENT = "  ";

function camelCase(snake: string): string {
	return snake.replace(/_([a-z0-9])/g, (_match, letter: string) =>
		letter.toUpperCase(),
	);
}

function pluralize(name: string): string {
	if (name.endsWith("s")) {
		return name;
	}
	if (/[^aeiou]y$/.test(name)) {
		return `${name.slice(0, -1)}ies`;
	}
	return /(ch|sh|x|z)$/.test(name) ? `${name}es` : `${name}s`;
}

/**
 * The property the bridged Pulumi provider gives a Terraform attribute:
 * its camelCase name, pluralized for a list (`cap_add` is `capAdds`).
 */
export function pulumiProperty(attribute: IacAttribute): string {
	const name = camelCase(attribute.tf);
	return attribute.kind === "strings" || attribute.kind === "objects"
		? pluralize(name)
		: name;
}

/** The Pulumi class of a resource type: `homerun_service_environment` is `ServiceEnvironment`. */
export function pulumiClass(type: string): string {
	const camel = camelCase(type.replace(/^homerun_/, ""));
	return `${camel.charAt(0).toUpperCase()}${camel.slice(1)}`;
}

/** The type token Pulumi records a resource type under, `homerun:index/serviceEnvironment:ServiceEnvironment`. */
export function pulumiType(type: string): string {
	const className = pulumiClass(type);
	return `homerun:index/${className.charAt(0).toLowerCase()}${className.slice(1)}:${className}`;
}

const RESOURCE_BY_TOKEN = new Map(
	IAC_RESOURCES.map((resource) => [pulumiType(resource.type), resource]),
);

function isSecret(value: unknown): boolean {
	if (Array.isArray(value)) {
		return value.some(isSecret);
	}
	if (value && typeof value === "object") {
		return (
			ENCRYPTED_VALUE_SIGNATURE in value ||
			Object.values(value as Record<string, unknown>).some(isSecret)
		);
	}
	return false;
}

/** A Pulumi output as Terraform state holds it: nested objects keyed by their Terraform names. */
function fromPulumi(attribute: IacAttribute, value: unknown): unknown {
	const fields = attribute.fields;
	if (!fields || value === null || typeof value !== "object") {
		return value;
	}
	const rename = (entry: unknown) => {
		const object = (entry ?? {}) as Record<string, unknown>;
		return Object.fromEntries(
			fields.map((field) => [
				field.tf,
				fromPulumi(field, object[pulumiProperty(field)] ?? null),
			]),
		);
	};
	return Array.isArray(value) ? value.map(rename) : rename(value);
}

interface CheckpointResource {
	custom?: boolean;
	delete?: boolean;
	external?: boolean;
	id?: string;
	outputs?: Record<string, unknown>;
	type?: string;
	urn?: string;
}

/**
 * Every Homerun resource a Pulumi stack checkpoint (the file Pulumi's S3
 * backend keeps under `.pulumi/stacks/`) manages, as state instances keyed
 * by Terraform attribute name. Read-only (`get`) resources and pending
 * deletes are left out, and so are secret outputs, which Pulumi encrypts
 * with a key Homerun doesn't have.
 *
 * @throws When the body isn't a JSON object.
 */
export function pulumiInstances(body: string): StateInstance[] {
	const parsed: unknown = JSON.parse(body);
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("The checkpoint isn't a JSON object.");
	}
	const resources =
		(
			parsed as {
				checkpoint?: { latest?: { resources?: CheckpointResource[] } };
			}
		).checkpoint?.latest?.resources ?? [];
	return resources.flatMap((entry) => {
		const resource = RESOURCE_BY_TOKEN.get(entry.type ?? "");
		if (!resource || !entry.custom || entry.delete || entry.external) {
			return [];
		}
		const outputs = entry.outputs ?? {};
		const attributes: Record<string, unknown> = {
			id: entry.id ?? outputs.id,
		};
		for (const attribute of resource.attributes) {
			const property = pulumiProperty(attribute);
			if (property in outputs && !isSecret(outputs[property])) {
				attributes[attribute.tf] = fromPulumi(attribute, outputs[property]);
			}
		}
		const name = entry.urn?.split("::").at(-1) ?? "";
		return [
			{
				address: `homerun.${pulumiClass(resource.type)}(${JSON.stringify(name)})`,
				attributes,
				type: resource.type,
			},
		];
	});
}

/**
 * Compares a Pulumi stack checkpoint with what's running, the way
 * `detectDrift` compares a Terraform state.
 *
 * @throws When the body isn't a JSON object.
 */
export function detectPulumiDrift(
	body: string,
	inventory: Inventory,
): DriftReport {
	return compareInstances(pulumiInstances(body), inventory);
}

/** A generated value with nested objects keyed by Pulumi property names, maps sorted, nulls dropped. */
function pulumiValue(attribute: IacAttribute, value: HclValue): HclValue {
	if (value === null || typeof value !== "object" || isExpression(value)) {
		return value;
	}
	if (attribute.kind === "stringMap" || attribute.kind === "intMap") {
		return Object.fromEntries(
			Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
		);
	}
	const fields = attribute.fields;
	if (!fields) {
		return value;
	}
	const rename = (entry: HclValue): HclValue => {
		const object = entry as Record<string, HclValue>;
		return Object.fromEntries(
			fields
				.filter((field) => object[field.tf] !== null)
				.map((field) => [
					pulumiProperty(field),
					pulumiValue(field, object[field.tf]),
				]),
		);
	};
	return Array.isArray(value) ? value.map(rename) : rename(value);
}

function isScalar(value: HclValue): boolean {
	return value === null || typeof value !== "object" || isExpression(value);
}

/** A value as a TypeScript literal at `indent`, objects and lists of objects broken over lines. */
export function renderTypeScript(value: HclValue, indent = ""): string {
	if (value === null) {
		return "null";
	}
	if (typeof value === "string") {
		return JSON.stringify(value);
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	if (isExpression(value)) {
		return value.expression;
	}
	const inner = indent + INDENT;
	if (Array.isArray(value)) {
		if (value.every(isScalar)) {
			return `[${value.map((item) => renderTypeScript(item, inner)).join(", ")}]`;
		}
		const items = value.map(
			(item) => `${inner}${renderTypeScript(item, inner)},`,
		);
		return `[\n${items.join("\n")}\n${indent}]`;
	}
	const entries = Object.entries(value).filter(([, item]) => item !== null);
	if (entries.length === 0) {
		return "{}";
	}
	const lines = entries.map(
		([key, item]) =>
			`${inner}${IDENTIFIER.test(key) ? key : JSON.stringify(key)}: ${renderTypeScript(item, inner)},`,
	);
	return `{\n${lines.join("\n")}\n${indent}}`;
}

/** A single-quoted shell word. */
function shellQuote(text: string): string {
	return `'${text.replaceAll("'", "'\\''")}'`;
}

function secretsScript(
	variables: SecretVariable[],
	mode: "masked" | "values",
): string {
	const lines = variables.map((variable) => {
		const empty = variable.type === "map(string)" ? "{}" : "";
		if (variable.value === null) {
			return `# pulumi config set --secret ${variable.name} -- ${shellQuote(empty)} # Homerun never returns it: fill it in`;
		}
		return `pulumi config set --secret ${variable.name} -- ${shellQuote(mode === "masked" ? SECRET_MASK : variable.value)}`;
	});
	return `#!/bin/sh\nset -e\n${lines.join("\n")}\n`;
}

/** How many stacks up a stack's parent chain goes, so a program declares a parent before the stacks nested in it. */
function stackDepth(stacks: LiveObject[], stack: LiveObject): number {
	let depth = 0;
	let parentId = stack.parentId;
	const seen = new Set<unknown>();
	while (typeof parentId === "string" && parentId && !seen.has(parentId)) {
		seen.add(parentId);
		depth++;
		parentId = stacks.find((entry) => entry.id === parentId)?.parentId;
	}
	return depth;
}

function ordered(
	resource: IacResource,
	inventory: Inventory,
	names: Map<string, Map<string, string>>,
): { name: string; object: LiveObject }[] {
	const objects = inventory[resource.type] ?? [];
	return objects
		.map((object) => ({
			depth:
				resource.type === "homerun_stack" ? stackDepth(objects, object) : 0,
			name: names.get(resource.type)?.get(importIdOf(resource, object)) ?? "",
			object,
		}))
		.sort(
			(a, b) =>
				a.depth - b.depth || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
		);
}

export interface PulumiOptions {
	/** The instance's URL the provider talks to. */
	endpoint: string;
	generatedAt: Date;
	/** The `pulumi login` command for the project's folder in its bucket, null when the store is gone. */
	login: string | null;
	/** What the program covers, a stack's or a service's name, for its README. */
	name: string;
	/** The Pulumi project's name, in `Pulumi.yaml` and `package.json`. */
	project: string;
}

function readme(options: PulumiOptions, hasSecrets: boolean): string {
	const steps = [
		`Log in to this project's folder in the bucket, with a bucket access key from the Credentials tab as \`AWS_ACCESS_KEY_ID\` and \`AWS_SECRET_ACCESS_KEY\`: ${options.login ? `\`${options.login}\`` : "the `pulumi login` command on the State tab"}.`,
		"Run `pulumi stack init <stack>` (`prod`, say). Pulumi encrypts the stack's secrets with a passphrase: set `PULUMI_CONFIG_PASSPHRASE` so it doesn't ask every time.",
		`Run \`npm install\`, then \`pulumi package add terraform-provider ${PROVIDER_SOURCE}\`: Pulumi downloads the Terraform provider, generates the \`${PULUMI_PACKAGE}\` SDK and adds it to \`package.json\` and \`Pulumi.yaml\`.`,
		`Export a Homerun API key: \`export HOMERUN_ENDPOINT=${options.endpoint}\` and \`export HOMERUN_API_KEY=<key>\`.`,
		...(hasSecrets
			? [
					"`secrets.sh` stores the secrets as encrypted stack config: env vars marked secret come filled in with what runs today, and the commented-out lines are secrets Homerun never reads back, to fill in. Run `sh secrets.sh`, and keep it out of git (the `.gitignore` does).",
				]
			: []),
		"Run `pulumi preview`: the `import` options adopt what already runs, so the preview only imports.",
		"Run `pulumi up`. From then on, change the program and run `pulumi up` instead of clicking.",
	];
	return [
		`# ${options.name}`,
		"",
		`Pulumi program (TypeScript) for ${options.name} on Homerun (${options.endpoint}), generated on ${options.generatedAt.toISOString().slice(0, 10)}. It runs the ${PROVIDER_SOURCE} Terraform provider through Pulumi's Terraform bridge.`,
		"",
		...steps.map((step, index) => `${index + 1}. ${step}`),
		"",
	].join("\n");
}

/** A TypeScript variable name per resource, keyed `<type>:<local name>`, unique across the program. */
function variableNames(
	names: ReturnType<typeof localNames>,
): Map<string, string> {
	const variables = new Map<string, string>();
	const taken = new Set<string>();
	for (const resource of IAC_RESOURCES) {
		for (const localName of names.get(resource.type)?.values() ?? []) {
			const base = camelCase(
				`${localName}_${resource.type.replace(/^homerun_/, "")}`,
			);
			let candidate = base;
			for (let suffix = 2; taken.has(candidate); suffix++) {
				candidate = `${base}${suffix}`;
			}
			taken.add(candidate);
			variables.set(`${resource.type}:${localName}`, candidate);
		}
	}
	return variables;
}

/** The Pulumi.yaml, package.json and tsconfig.json every generated project carries. */
function projectFiles(options: PulumiOptions): GeneratedFile[] {
	return [
		{
			content: [
				`name: ${options.project}`,
				`description: ${JSON.stringify(`Homerun resources for ${options.name}`)}`,
				"runtime: nodejs",
				"",
			].join("\n"),
			path: "Pulumi.yaml",
		},
		{
			content: `${JSON.stringify(
				{
					dependencies: { "@pulumi/pulumi": "^3.0.0" },
					devDependencies: { "@types/node": "^22.0.0", typescript: "^5.0.0" },
					main: "index.ts",
					name: options.project,
					private: true,
				},
				null,
				2,
			)}\n`,
			path: "package.json",
		},
		{
			content: `${JSON.stringify(
				{
					compilerOptions: {
						module: "commonjs",
						moduleResolution: "node",
						outDir: "bin",
						strict: true,
						target: "es2020",
					},
					files: ["index.ts"],
				},
				null,
				2,
			)}\n`,
			path: "tsconfig.json",
		},
	];
}

/**
 * A ready-to-run Pulumi project (TypeScript) for what's running: one
 * `new homerun.X(...)` per object with the `import` option set to its id,
 * so `pulumi up` adopts them instead of creating new ones, references
 * between generated objects as their `.id`. Values the API never returns
 * (passwords, keys) and env vars marked secret are read from encrypted
 * stack config, set by `secrets.sh` (with the env vars' current values, and
 * a masked `preview` for a page). Objects come in a fixed order, so two
 * runs on the same instance match.
 */
export function generatePulumiProgram(
	inventory: Inventory,
	options: PulumiOptions,
): GeneratedFile[] {
	const names = localNames(inventory);
	const variables = variableNames(names);
	const context: RenderContext = {
		names,
		reference: (type, localName) =>
			expression(`${variables.get(`${type}:${localName}`)}.id`),
		secret: (variable) =>
			expression(
				variable.type === "map(string)"
					? `config.requireSecretObject<Record<string, string>>(${JSON.stringify(variable.name)})`
					: `config.requireSecret(${JSON.stringify(variable.name)})`,
			),
		variables: [],
	};
	const statements: string[] = [];
	for (const resource of IAC_RESOURCES) {
		for (const { name, object } of ordered(resource, inventory, names)) {
			const args = Object.fromEntries(
				configuredAttributes(resource, object, name, context).map(
					([attribute, value]) => [
						pulumiProperty(attribute),
						pulumiValue(attribute, value),
					],
				),
			);
			statements.push(
				[
					`const ${variables.get(`${resource.type}:${name}`)} = new homerun.${pulumiClass(resource.type)}(`,
					`${INDENT}${JSON.stringify(name)},`,
					`${INDENT}${renderTypeScript(args, INDENT)},`,
					`${INDENT}{ import: ${JSON.stringify(importIdOf(resource, object))} },`,
					");",
				].join("\n"),
			);
		}
	}
	const hasSecrets = context.variables.length > 0;
	const header = [
		`import * as homerun from "${PULUMI_PACKAGE}";`,
		...(hasSecrets
			? [
					'import * as pulumi from "@pulumi/pulumi";',
					"",
					"const config = new pulumi.Config();",
				]
			: []),
	];
	const files: GeneratedFile[] = [
		{ content: readme(options, hasSecrets), path: "README.md" },
		...projectFiles(options),
		{
			content: `${[header.join("\n"), ...statements].join("\n\n")}\n`,
			path: "index.ts",
		},
	];
	if (hasSecrets) {
		files.push({
			content: secretsScript(context.variables, "values"),
			path: "secrets.sh",
			preview: secretsScript(context.variables, "masked"),
		});
	}
	files.push({
		content: "node_modules/\nbin/\nsdks/\nsecrets.sh\n",
		path: ".gitignore",
	});
	return files;
}
