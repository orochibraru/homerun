/**
 * Why a new storage volume can't be created, or null: it needs a name, a
 * kind (`bind`, a host path, or `volume`, a Docker volume) and a source, and
 * a bind's source is an absolute path, as is a Docker volume's disk.
 */
export function storageVolumeProblem(input: {
	disk?: string | null;
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
	if (input.kind === "bind" && !input.source.trim().startsWith("/")) {
		return "Host path must be absolute (start with /).";
	}
	const disk = input.disk?.trim();
	if (input.kind === "volume" && disk && !disk.startsWith("/")) {
		return "Disk must be a mount point on this host (start with /).";
	}
	if (input.kind === "volume" && disk && input.source.includes("/")) {
		return "A volume placed on a disk needs a plain name, without /.";
	}
	return null;
}
