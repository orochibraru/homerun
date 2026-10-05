/**
 * Why a new storage volume can't be created, or null: it needs a name, a
 * kind (`bind`, a host path, or `volume`, a Docker volume) and a source, and
 * a bind's source is an absolute path.
 */
export function storageVolumeProblem(input: {
	kind: string | null;
	name: string;
	source: string;
}): string | null {
	if (!input.name.trim()) {
		return "Name is required.";
	}
	if (input.kind !== "bind" && input.kind !== "volume") {
		return "Choose a volume type.";
	}
	if (!input.source.trim()) {
		return input.kind === "bind"
			? "Host path is required."
			: "Volume name is required.";
	}
	return input.kind === "bind" && !input.source.trim().startsWith("/")
		? "Host path must be absolute (start with /)."
		: null;
}
