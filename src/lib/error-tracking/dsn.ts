export interface DsnProject {
	projectId: number;
	publicKey: string;
}

/**
 * The DSN an SDK is configured with: `<scheme>://<key>@<host><path>/<id>`,
 * the SDK then posting to `<path>/api/<id>/envelope/`. `origin` is the
 * dashboard URL, a path included when the dashboard is served under one.
 * Null when the origin isn't a URL.
 */
export function publicDsn(origin: string, project: DsnProject): string | null {
	try {
		const url = new URL(origin);
		const path = url.pathname.replace(/\/+$/, "");
		return `${url.protocol}//${project.publicKey}@${url.host}${path}/${project.projectId}`;
	} catch {
		return null;
	}
}

/**
 * The DSN a container on the Homerun network uses to reach the dashboard
 * container directly, without a round trip through the public URL: plain
 * http to its network alias and port, keeping the dashboard URL's path.
 */
export function internalDsn(
	host: string,
	port: number,
	origin: string | null,
	project: DsnProject,
): string {
	let path = "";
	try {
		path = origin ? new URL(origin).pathname.replace(/\/+$/, "") : "";
	} catch {
		path = "";
	}
	return `http://${project.publicKey}@${host}:${port}${path}/${project.projectId}`;
}

export interface SentryEnvInput {
	dsn: string;
	environment: string;
	/** The release when it's known up front: a rollback's commit, an image's ref. Null for a git build, whose commit the worker fills in. */
	release: string | null;
	userEnv: Record<string, string>;
}

export const RELEASE_ENV = "SENTRY_RELEASE";

/**
 * The `SENTRY_*` variables injected into a deploy, each left out when the
 * service sets it itself. `releaseFromBuild` asks the worker to set
 * `SENTRY_RELEASE` to the commit it builds.
 */
export function sentryEnv(input: SentryEnvInput): {
	env: [string, string][];
	releaseFromBuild: boolean;
} {
	const env: [string, string][] = [];
	const add = (key: string, value: string) => {
		if (!(key in input.userEnv)) {
			env.push([key, value]);
		}
	};
	add("SENTRY_DSN", input.dsn);
	add("SENTRY_ENVIRONMENT", input.environment);
	if (input.release) {
		add(RELEASE_ENV, input.release);
	}
	return {
		env,
		releaseFromBuild: !input.release && !(RELEASE_ENV in input.userEnv),
	};
}
