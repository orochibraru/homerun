import type { IacAttribute } from "#lib/iac/resources.js";

/**
 * An API value as Terraform state holds it: nested objects keyed by their
 * snake_case attribute names, absent values as null.
 */
export function toStateValue(attribute: IacAttribute, value: unknown): unknown {
	if (value === undefined || value === null) {
		return null;
	}
	if (attribute.kind === "objects" && Array.isArray(value)) {
		return value.map((entry: Record<string, unknown>) =>
			nestedStateValue(attribute, entry),
		);
	}
	if (attribute.kind === "object" && typeof value === "object") {
		return nestedStateValue(attribute, value as Record<string, unknown>);
	}
	return value;
}

function nestedStateValue(
	attribute: IacAttribute,
	entry: Record<string, unknown> | null,
): Record<string, unknown> {
	return Object.fromEntries(
		(attribute.fields ?? []).map((field) => [
			field.tf,
			toStateValue(field, entry?.[field.name]),
		]),
	);
}
