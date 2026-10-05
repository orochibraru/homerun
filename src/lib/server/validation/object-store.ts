import { endpointProblem } from "#lib/object-storage.js";

export interface ObjectStoreFormValues {
	accessKeyId: string;
	endpoint: string;
	name: string;
	region: string;
	secretAccessKey: string;
}

/**
 * The connection fields of the add/edit store form, trimmed, with the first
 * problem found. A blank secret is a problem only when `requireSecret`, so an
 * edit can keep the stored one.
 */
export function parseObjectStoreForm(
	formData: FormData,
	requireSecret: boolean,
): { error: string | null; values: ObjectStoreFormValues } {
	const field = (name: string) => String(formData.get(name) ?? "").trim();
	const values = {
		accessKeyId: field("accessKeyId"),
		endpoint: field("endpoint").replace(/\/+$/, ""),
		name: field("name"),
		region: field("region") || "us-east-1",
		secretAccessKey: field("secretAccessKey"),
	};
	let error: string | null = null;
	if (!values.name) {
		error = "Give the store a name.";
	} else if (endpointProblem(values.endpoint)) {
		error = endpointProblem(values.endpoint);
	} else if (!values.accessKeyId) {
		error = "The access key id is required.";
	} else if (requireSecret && !values.secretAccessKey) {
		error = "The secret access key is required.";
	}
	return { error, values };
}
