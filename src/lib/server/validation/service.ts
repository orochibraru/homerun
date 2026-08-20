import { z } from "zod";

// Optional numeric fields that come from a plain <input>: an empty field
// still submits as "" in FormData, and z.coerce.number() turns "" into 0
// (not NaN/undefined) : which then fails a .positive()/.min() check with
// no obvious cause. Treat "" as "not provided" before coercion.
const optionalNumber = (schema: z.ZodNumber | z.ZodCoercedNumber) =>
	z.preprocess(
		(val) => (val === "" || val === undefined ? undefined : val),
		schema.optional(),
	);

const baseServiceSchema = z.object({
	// Checkbox convention (also used below): present ("on") when checked,
	// absent from FormData entirely when unchecked : never a literal
	// "false" to coerce.
	authRequired: z.preprocess(
		(val) => val === "on" || val === true,
		z.boolean(),
	),
	// Opt-in : whether CronService's autoscale tick may migrate this service
	// onto the configured overflow remote host (Settings' Autoscaling
	// section) when the local host is over threshold. See schema.ts's
	// `service.autoscaleEligible` docstring.
	autoscaleEligible: z.preprocess(
		(val) => val === "on" || val === true,
		z.boolean(),
	),
	// "image" (bring-your-own, the default) | "git" (clone + build a
	// Dockerfile) : cross-checked against the other git*/image fields below,
	// since which of those is required depends on this.
	buildSource: z.enum(["image", "git"]).default("image"),
	containerPort: z.coerce
		.number({ error: "Container port is required." })
		.int()
		.min(1)
		.max(65_535),
	cpuLimit: z.string().optional(),
	dnsResolvable: z.preprocess(
		(val) => val === "on" || val === true,
		z.boolean(),
	),
	gitBuildContext: z.string().optional(),
	gitDockerfilePath: z.string().optional(),
	gitRef: z.string().optional(),
	gitUrl: z.string().optional(),
	image: z.string().optional(),
	memoryLimitMb: optionalNumber(z.coerce.number().int().positive()),
	name: z.string().min(1, "Name is required.").max(100),
	// "bridge" (default, Traefik-routed on the shared network) | "host"
	// (shares the host's network namespace directly : mDNS/SSDP-dependent
	// apps like Home Assistant; forces dnsResolvable off server-side, see
	// networking/+page.server.ts's `updatePorts` action).
	networkMode: z.enum(["bridge", "host"]).default("bridge"),
	// Which protocol(s) containerPort is exposed under : see schema.ts's
	// `service.portProtocol` docstring for what this does and doesn't mean.
	portProtocol: z.enum(["tcp", "udp", "both"]).default("tcp"),
	registryPassword: z.string().optional(),
	registryUrl: z.string().optional(),
	registryUsername: z.string().optional(),
	restartPolicy: z
		.enum(["no", "always", "on-failure", "unless-stopped"])
		.default("unless-stopped"),
	slug: z
		.string()
		.min(1, "Slug is required.")
		.regex(
			/^[a-z0-9-]{1,63}$/,
			"Lowercase letters, numbers, and hyphens only.",
		),
	tag: z.string().optional(),
});

/** buildSource-dependent required field, shared by createServiceSchema and updateSourceSchema below. */
function requireImageOrGitUrl(
	input: { buildSource: "image" | "git"; gitUrl?: string; image?: string },
	ctx: z.RefinementCtx,
) {
	if (input.buildSource === "git") {
		if (!input.gitUrl) {
			ctx.addIssue({
				code: "custom",
				message: "Git repository URL is required.",
				path: ["gitUrl"],
			});
		}
		return;
	}
	if (!input.image) {
		ctx.addIssue({
			code: "custom",
			message: "Image is required.",
			path: ["image"],
		});
	}
}

export const createServiceSchema =
	baseServiceSchema.superRefine(requireImageOrGitUrl);

export type CreateServiceInput = z.infer<typeof createServiceSchema>;

// The existing-service Settings tab is split across independent forms/
// actions/routes (Settings for the fields below, Source for build/image/git/
// registry : see services/[serviceId]/source/, Networking's own "Network"
// section for port/protocol/network-mode/DNS : see updatePortsSchema below),
// each validated against only its own subset of baseServiceSchema rather
// than the full create-time shape.
export const updateGeneralSchema = baseServiceSchema.pick({
	name: true,
	restartPolicy: true,
	slug: true,
});
export type UpdateGeneralInput = z.infer<typeof updateGeneralSchema>;

// Backs the Compute tab : cpu/memory limits (moved off the old Settings
// tab) plus autoscale opt-in, since they're all "how much of the host this
// service is allowed to use, and what happens when that's not enough"
// (see the Autoscaling section on Settings for the instance-wide half).
export const updateComputeSchema = baseServiceSchema.pick({
	autoscaleEligible: true,
	cpuLimit: true,
	memoryLimitMb: true,
});
export type UpdateComputeInput = z.infer<typeof updateComputeSchema>;

// Backs the Networking tab's "Network" section : container port, which
// protocol(s) it's exposed under, network mode (bridge/host), and
// DNS-resolvability all live together here since they're all "how this
// container attaches to the network" in one way or another (moved off the
// old Settings tab, which used to own containerPort/dnsResolvable).
export const updatePortsSchema = baseServiceSchema.pick({
	containerPort: true,
	dnsResolvable: true,
	networkMode: true,
	portProtocol: true,
});
export type UpdatePortsInput = z.infer<typeof updatePortsSchema>;

// registryPassword is optional here too: blank means "leave the stored
// credential unchanged", not "clear it" (see source/+page.server.ts).
export const updateSourceSchema = baseServiceSchema
	.pick({
		buildSource: true,
		gitBuildContext: true,
		gitDockerfilePath: true,
		gitRef: true,
		gitUrl: true,
		image: true,
		registryPassword: true,
		registryUrl: true,
		registryUsername: true,
		tag: true,
	})
	.superRefine(requireImageOrGitUrl);
export type UpdateSourceInput = z.infer<typeof updateSourceSchema>;

/** Zips parallel envKey[]/envValue[] form fields into a record, dropping blank keys. */
export function parseEnvVars(formData: FormData): Record<string, string> {
	const keys = formData.getAll("envKey").map(String);
	const values = formData.getAll("envValue").map(String);
	const env: Record<string, string> = {};
	keys.forEach((key, i) => {
		const trimmed = key.trim();
		if (trimmed) {
			env[trimmed] = values[i] ?? "";
		}
	});
	return env;
}
