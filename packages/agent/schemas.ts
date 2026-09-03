import { z } from "zod";

/**
 * Single source of truth for both request validation and the OpenAPI spec
 * (`openapi.ts`) : same "one zod schema drives both" approach as the main
 * app's `$lib/server/validation/api.ts` / `$lib/openapi/`. Previously
 * `/v1/deploy`'s body was just `as DeployInput` : an unchecked cast, not
 * real validation; a malformed request would fail deep inside dockerode
 * with a confusing error instead of a clean 400. Fixed by actually parsing
 * against this schema in `http.ts`.
 */
export const envVarSchema = z.object({
	key: z.string().min(1),
	value: z.string(),
});

export const deployInputSchema = z.object({
	containerPort: z.number().int().min(1).max(65_535).nullable(),
	cpuLimit: z.number().positive().nullable(),
	envVars: z.array(envVarSchema).default([]),
	image: z.string().min(1),
	memoryLimitMb: z.number().int().positive().nullable(),
	networkMode: z.enum(["bridge", "host"]),
	portProtocol: z.enum(["tcp", "udp", "both"]),
	registryAuth: z
		.object({
			password: z.string(),
			serveraddress: z.string().optional(),
			username: z.string(),
		})
		.nullable()
		.optional(),
	restartPolicy: z.enum(["no", "always", "on-failure", "unless-stopped"]),
	serviceId: z.string().min(1),
	// True when `image:tag` was just built on this same daemon by
	// POST /v1/build (see buildInputSchema below) rather than published
	// anywhere : a plain `docker pull` of a purely local tag fails ("repository
	// does not exist"), so the deploy pipeline has to know to skip it and
	// deploy the already-local image directly. Defaults false, so an ordinary
	// registry-image deploy (the original, still the common case) is
	// unaffected.
	skipPull: z.boolean().optional().default(false),
	slug: z.string().min(1),
	tag: z.string().min(1),
});

export type DeployInput = z.infer<typeof deployInputSchema>;

/**
 * POST /v1/build's body : clone a git repo at a ref and build its
 * Dockerfile into a local image tagged `tag`, mirroring the main app's own
 * `docker/git-build.ts` (`buildFromGit`), just without that one's
 * pre-build cache-from pull, this daemon already keeps its own layer cache
 * between builds since it's the same local dockerode instance every time,
 * there's nothing to pull back in. `push`, when present, publishes the
 * built image to a registry afterward (a build-cache-registry in the main
 * app's terms) : required whenever this build's result has to reach a
 *different* daemon than the one that built it (a different deploy
 * target), since two daemons never share an image store; omitted entirely
 * when the build and deploy targets are this same agent, the deploy step
 * just references the local tag directly (see `deployInputSchema`'s
 * `skipPull`).
 */
export const buildInputSchema = z.object({
	buildContext: z.string().nullable().optional(),
	dockerfilePath: z.string().nullable().optional(),
	gitRef: z.string().nullable().optional(),
	gitUrl: z.string().min(1),
	push: z
		.object({
			password: z.string(),
			registryUrl: z.string().min(1),
			// The full ref to push to, e.g. "registry.example.com/my-image:cache".
			tag: z.string().min(1),
			username: z.string(),
		})
		.nullable()
		.optional(),
	tag: z.string().min(1),
});

export type BuildInput = z.infer<typeof buildInputSchema>;
