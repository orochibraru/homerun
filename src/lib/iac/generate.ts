import {
	expression,
	type HclBlock,
	type HclValue,
	renderHcl,
} from "#lib/iac/hcl.js";
import {
	IAC_RESOURCES,
	type IacAttribute,
	type IacResource,
	importIdOf,
	toStateValue,
} from "#lib/iac/resources.js";

export type LiveObject = Record<string, unknown>;

/** Every live object Homerun manages, by Terraform resource type, as the REST API returns it. */
export type Inventory = Record<string, LiveObject[]>;

export const PROVIDER_SOURCE = "orochibraru/homerun";

export interface GenerateOptions {
	/** The Terraform state project's API base, `<origin>/api/v1/iac/projects/<id>`, or null for no backend block. */
	backendAddress: string | null;
	/** The instance's URL the provider talks to. */
	endpoint: string;
	generatedAt: Date;
}

const RESERVED_NAMES = new Set(["count", "for_each", "provider", "lifecycle"]);

/** A Terraform name (letters, digits, underscores) from free text. */
export function terraformName(text: string): string {
	const name = text
		.toLowerCase()
		.replace(/[^a-z0-9_]+/g, "_")
		.replace(/^_+|_+$/g, "");
	if (!name) {
		return "unnamed";
	}
	return /^[0-9]/.test(name) || RESERVED_NAMES.has(name) ? `r_${name}` : name;
}

function stringField(object: LiveObject, field: string): string {
	const value = object[field];
	return typeof value === "string" ? value : "";
}

/** The ids of a stack and every stack nested under it, at any depth. */
function stackFamily(stacks: LiveObject[], rootId: string): Set<string> {
	const family = new Set([rootId]);
	let grew = true;
	while (grew) {
		grew = false;
		for (const stack of stacks) {
			const id = stringField(stack, "id");
			if (!family.has(id) && family.has(stringField(stack, "parentId"))) {
				family.add(id);
				grew = true;
			}
		}
	}
	return family;
}

/**
 * The part of an inventory one stack covers: the stack and its substacks,
 * their services with those services' environments, dependencies, mounts
 * and mounted volumes, and the status pages of those stacks.
 */
export function scopeToStack(inventory: Inventory, stackId: string): Inventory {
	const stacks = stackFamily(inventory.homerun_stack ?? [], stackId);
	const pick = (type: string, keep: (object: LiveObject) => boolean) =>
		(inventory[type] ?? []).filter(keep);
	const services = pick("homerun_service", (svc) =>
		stacks.has(stringField(svc, "stackId")),
	);
	const serviceIds = new Set(services.map((svc) => stringField(svc, "id")));
	const ofService = (object: LiveObject) =>
		serviceIds.has(stringField(object, "serviceId"));
	const mounts = pick("homerun_volume_mount", ofService);
	const volumeIds = new Set(
		mounts.map((mount) => stringField(mount, "volumeId")),
	);
	return {
		homerun_service: services,
		homerun_service_dependency: pick("homerun_service_dependency", ofService),
		homerun_service_environment: pick("homerun_service_environment", ofService),
		homerun_stack: pick("homerun_stack", (stack) =>
			stacks.has(stringField(stack, "id")),
		),
		homerun_status_page: pick("homerun_status_page", (page) =>
			stacks.has(stringField(page, "stackId")),
		),
		homerun_volume: pick("homerun_volume", (volume) =>
			volumeIds.has(stringField(volume, "id")),
		),
		homerun_volume_mount: mounts,
	};
}

/** Each object's local name in the configuration, unique per type, by type then id. */
export function localNames(
	inventory: Inventory,
): Map<string, Map<string, string>> {
	const names = new Map<string, Map<string, string>>();
	const nameOf = (type: string, id: string) => names.get(type)?.get(id) ?? "";
	for (const resource of IAC_RESOURCES) {
		const taken = new Set<string>();
		const byId = new Map<string, string>();
		for (const object of inventory[resource.type] ?? []) {
			let base = terraformName(stringField(object, resource.label));
			if (resource.type === "homerun_service_dependency") {
				base = `${nameOf("homerun_service", stringField(object, "serviceId"))}_on_${nameOf("homerun_service", stringField(object, "dependsOnId"))}`;
			} else if (resource.type === "homerun_volume_mount") {
				base = `${nameOf("homerun_service", stringField(object, "serviceId"))}_${nameOf("homerun_volume", stringField(object, "volumeId"))}`;
			}
			let name = base;
			for (let suffix = 2; taken.has(name); suffix++) {
				name = `${base}_${suffix}`;
			}
			taken.add(name);
			byId.set(importIdOf(resource, object), name);
		}
		names.set(resource.type, byId);
	}
	return names;
}

function isEmpty(value: unknown): boolean {
	return (
		value === null ||
		value === undefined ||
		(Array.isArray(value) && value.length === 0) ||
		(typeof value === "object" &&
			!Array.isArray(value) &&
			Object.keys(value as object).length === 0)
	);
}

interface RenderContext {
	names: Map<string, Map<string, string>>;
	variables: HclBlock[];
}

function variable(
	context: RenderContext,
	name: string,
	description: string,
	type = "string",
) {
	context.variables.push({
		attributes: [
			["description", description],
			["sensitive", true],
			["type", expression(type)],
		],
		labels: [name],
		type: "variable",
	});
	return expression(`var.${name}`);
}

function envVarsValue(
	object: LiveObject,
	localName: string,
	context: RenderContext,
): HclValue {
	const secretKeys = new Set(
		Array.isArray(object.secretEnvKeys) ? object.secretEnvKeys : [],
	);
	const vars = (object.envVars ?? {}) as Record<string, string>;
	return Object.fromEntries(
		Object.entries(vars).map(([envKey, value]) => [
			envKey,
			secretKeys.has(envKey)
				? variable(
						context,
						`${localName}_${terraformName(envKey)}`,
						`${envKey} of ${localName}`,
					)
				: value,
		]),
	);
}

function attributeValue(
	attribute: IacAttribute,
	object: LiveObject,
	localName: string,
	context: RenderContext,
): HclValue | undefined {
	if (attribute.readOnly || attribute.createOnly) {
		return;
	}
	if (attribute.writeOnly) {
		return attribute.required
			? variable(
					context,
					`${localName}_${attribute.tf}`,
					`${attribute.tf} of ${localName}`,
					attribute.kind === "stringMap" ? "map(string)" : "string",
				)
			: undefined;
	}
	const value = object[attribute.name];
	if (attribute.ref && typeof value === "string" && value) {
		const target = context.names.get(attribute.ref)?.get(value);
		return target ? expression(`${attribute.ref}.${target}.id`) : value;
	}
	if (
		!attribute.required &&
		(isEmpty(value) ||
			JSON.stringify(value) === JSON.stringify(attribute.default))
	) {
		return;
	}
	if (attribute.name === "envVars" && "secretEnvKeys" in object) {
		return envVarsValue(object, localName, context);
	}
	return toStateValue(attribute, value) as HclValue;
}

function resourceBlock(
	resource: IacResource,
	object: LiveObject,
	localName: string,
	context: RenderContext,
): HclBlock {
	const attributes: [string, HclValue][] = [];
	for (const attribute of resource.attributes) {
		const value = attributeValue(attribute, object, localName, context);
		if (value !== undefined) {
			attributes.push([attribute.tf, value]);
		}
	}
	return { attributes, labels: [resource.type, localName], type: "resource" };
}

function terraformBlock(options: GenerateOptions): HclBlock {
	const base = options.backendAddress;
	return {
		attributes: [],
		blocks: [
			{
				attributes: [["homerun", { source: PROVIDER_SOURCE }]],
				labels: [],
				type: "required_providers",
			},
			...(base
				? [
						{
							attributes: [
								["address", `${base}/state`],
								["lock_address", `${base}/lock`],
								["unlock_address", `${base}/lock`],
								["lock_method", "POST"],
								["unlock_method", "DELETE"],
								["username", "homerun"],
							] as [string, HclValue][],
							labels: ["http"],
							type: "backend",
						},
					]
				: []),
		],
		labels: [],
		type: "terraform",
	};
}

/**
 * A starter Terraform configuration for what's running: the provider (and
 * the state backend), then for every object a resource block plus an
 * `import` block, so `terraform plan` adopts them instead of creating new
 * ones. Values the API never returns (passwords, keys) become sensitive
 * variables, and so do the env vars marked secret. Objects come in a fixed
 * order (by type, then name), so two runs on the same instance match.
 */
export function generateConfiguration(
	inventory: Inventory,
	options: GenerateOptions,
): string {
	const context: RenderContext = {
		names: localNames(inventory),
		variables: [],
	};
	const resources: HclBlock[] = [];
	const imports: HclBlock[] = [];
	for (const resource of IAC_RESOURCES) {
		const objects = [...(inventory[resource.type] ?? [])]
			.map((object) => ({
				name:
					context.names.get(resource.type)?.get(importIdOf(resource, object)) ??
					"",
				object,
			}))
			.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
		for (const { name, object } of objects) {
			resources.push(resourceBlock(resource, object, name, context));
			imports.push({
				attributes: [
					["to", expression(`${resource.type}.${name}`)],
					["id", importIdOf(resource, object)],
				],
				labels: [],
				type: "import",
			});
		}
	}
	const header = [
		`# Generated by Homerun on ${options.generatedAt.toISOString()}.`,
		"# Set HOMERUN_API_KEY (and TF_HTTP_PASSWORD, the same key, for the state backend),",
		"# then run terraform init and terraform plan: the import blocks adopt what already runs.",
		"",
	].join("\n");
	return (
		header +
		renderHcl([
			terraformBlock(options),
			{
				attributes: [["endpoint", options.endpoint]],
				labels: ["homerun"],
				type: "provider",
			},
			...context.variables,
			...resources,
			...imports,
		])
	);
}

/** How many objects of each type an inventory holds, for the page's summary. */
export function inventoryCounts(
	inventory: Inventory,
): { count: number; type: string }[] {
	return IAC_RESOURCES.map((resource) => ({
		count: inventory[resource.type]?.length ?? 0,
		type: resource.type,
	})).filter((entry) => entry.count > 0);
}
