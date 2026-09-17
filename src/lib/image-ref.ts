/**
 * Splits an image reference into repository and tag. Any `@digest` is dropped,
 * a colon before the last slash is a registry port rather than a tag, and a
 * missing or empty tag defaults to `latest`.
 */
export function splitImageRef(ref: string): { image: string; tag: string } {
	const bare = ref.split("@")[0] ?? ref;
	const colon = bare.lastIndexOf(":");
	if (colon <= bare.lastIndexOf("/")) {
		return { image: bare, tag: "latest" };
	}
	return {
		image: bare.slice(0, colon),
		tag: bare.slice(colon + 1) || "latest",
	};
}
