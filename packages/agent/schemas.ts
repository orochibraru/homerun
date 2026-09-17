import { z } from "zod";
import { BAKE_TARGET_PATTERN, BUILD_METHODS } from "./builders";

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

/**
 * POST /v1/build's body : clone a git repo at a ref and build it with
 * BuildKit (its Dockerfile, a bake target) or a builder into a local image
 * tagged `tag`, mirroring the main app's own `docker/git-build.ts`
 * (`buildFromGit`). `push`, when present, names the service's build cache
 * registry : the BuildKit layer cache is imported from and exported to it,
 * and the built image is published to it afterward, required whenever
 * this build's result has to reach a *different* daemon than the one that
 * built it (a different deploy target), since two daemons never share an image store; omitted entirely
 * when the build and deploy targets are this same agent, the deploy step
 * just references the local tag directly (see the deploy path's
 * `skipPull`).
 */
export const buildInputSchema = z.object({
	bakeFile: z.string().nullable().optional(),
	bakeTarget: z.string().regex(BAKE_TARGET_PATTERN).nullable().optional(),
	buildContext: z.string().nullable().optional(),
	buildMethod: z.enum(BUILD_METHODS).nullable().optional(),
	commit: z
		.string()
		.regex(/^[0-9a-f]{40}$/i)
		.nullable()
		.optional(),
	// Injected into the clone URL for a private repo : the main app resolves
	// it from a connected git provider (`resolveGitCredential`) and sends it
	// here, since the agent has no access to that table.
	credential: z
		.object({ token: z.string().min(1), username: z.string() })
		.nullable()
		.optional(),
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

/** GET /v1/images/save's query : the local image ref to stream out as a `docker save` tarball. */
export const imageSaveQuerySchema = z.object({
	ref: z.string().min(1),
});
