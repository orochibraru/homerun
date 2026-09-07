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
 * just references the local tag directly (see the deploy path's
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
