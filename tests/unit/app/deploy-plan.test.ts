import { describe, expect, test } from "bun:test";
import {
	type BuildServer,
	type CacheRegistryCredentials,
	DeployPlanError,
	type DeployPlanInput,
	type DeployPlanService,
	resolveDeployPlan,
} from "../../../src/lib/services/deploy/plan";

const registry: CacheRegistryCredentials = {
	password: "secret",
	registryUrl: "registry.example.com",
	username: "builder",
};

const dockerServer = {
	connection: { dockerHost: "tcp://build:2376" },
	hostId: "host-docker",
	kind: "docker",
} as unknown as BuildServer;

const agentServer = {
	connection: { token: "t", url: "https://agent.example.com" },
	hostId: "host-agent",
	kind: "agent",
} as unknown as BuildServer;

function service(
	overrides: Partial<DeployPlanService> = {},
): DeployPlanService {
	return {
		buildServerRemoteHostId: null,
		buildSource: "image",
		gitBuildContext: null,
		gitDockerfilePath: null,
		gitRef: "main",
		gitUrl: null,
		image: "ghcr.io/acme/api",
		networkMode: "bridge",
		pullPolicy: "always",
		replicas: 3,
		tag: "latest",
		...overrides,
	};
}

function input(overrides: Partial<DeployPlanInput> = {}): DeployPlanInput {
	return {
		buildServer: null,
		cacheRegistry: null,
		orchestrationMode: "standalone",
		service: service(),
		...overrides,
	};
}

const gitService = (overrides: Partial<DeployPlanService> = {}) =>
	service({
		buildSource: "git",
		gitUrl: "https://github.com/acme/api.git",
		...overrides,
	});

describe("resolveDeployPlan, legal combinations", () => {
	test("image source, standalone : a pull into a container", () => {
		expect(resolveDeployPlan(input())).toEqual({
			image: {
				image: "ghcr.io/acme/api",
				kind: "pull",
				pullPolicy: "always",
				tag: "latest",
			},
			workload: { kind: "container", networkMode: "bridge" },
		});
	});

	test("a revision skips the build and the pull, and ignores missing git settings", () => {
		const revision = {
			buildSource: "git" as const,
			digest: null,
			gitCommit: "abc",
			gitRef: "main",
			id: "dep-1",
			imageId: "sha256:1",
			imageRef: "homerun-build-api:m1",
		};
		expect(
			resolveDeployPlan(
				input({ revision, service: gitService({ gitUrl: null }) }),
			).image,
		).toEqual({ kind: "revision", revision });
	});

	test("image source, swarm : a pull into a swarm service carrying replicas", () => {
		const plan = resolveDeployPlan(input({ orchestrationMode: "swarm" }));
		expect(plan.workload).toEqual({ kind: "swarm", replicas: 3 });
	});

	test("host networking stays legal in standalone mode", () => {
		const plan = resolveDeployPlan(
			input({ service: service({ networkMode: "host" }) }),
		);
		expect(plan.workload).toEqual({ kind: "container", networkMode: "host" });
	});

	test("image source ignores leftover build server and cache registry", () => {
		const plan = resolveDeployPlan(
			input({
				buildServer: dockerServer,
				cacheRegistry: registry,
				service: service({ buildServerRemoteHostId: "host-docker" }),
			}),
		);
		expect(plan.image.kind).toBe("pull");
	});

	test("git source without a build server builds locally, with or without a cache", () => {
		const bare = resolveDeployPlan(input({ service: gitService() }));
		expect(bare.image).toEqual({
			cacheRegistry: null,
			git: {
				buildContext: null,
				dockerfilePath: null,
				gitRef: "main",
				gitUrl: "https://github.com/acme/api.git",
			},
			kind: "local-build",
		});

		const cached = resolveDeployPlan(
			input({ cacheRegistry: registry, service: gitService() }),
		);
		expect(cached.image).toMatchObject({
			cacheRegistry: registry,
			kind: "local-build",
		});
	});

	test("git source with a local build is legal under swarm", () => {
		const plan = resolveDeployPlan(
			input({ orchestrationMode: "swarm", service: gitService() }),
		);
		expect(plan.image.kind).toBe("local-build");
		expect(plan.workload.kind).toBe("swarm");
	});

	test("git source on a docker build server publishes through the registry", () => {
		const plan = resolveDeployPlan(
			input({
				buildServer: dockerServer,
				cacheRegistry: registry,
				service: gitService({ buildServerRemoteHostId: "host-docker" }),
			}),
		);
		expect(plan.image).toMatchObject({
			kind: "docker-build",
			registry,
			server: dockerServer,
		});
	});

	test("git source on an agent build server publishes through the registry", () => {
		const plan = resolveDeployPlan(
			input({
				buildServer: agentServer,
				cacheRegistry: registry,
				orchestrationMode: "swarm",
				service: gitService({ buildServerRemoteHostId: "host-agent" }),
			}),
		);
		expect(plan.image).toMatchObject({
			kind: "agent-build",
			registry,
			server: agentServer,
		});
		expect(plan.workload.kind).toBe("swarm");
	});
});

describe("resolveDeployPlan, illegal combinations", () => {
	test("git source without a repository URL", () => {
		expect(() =>
			resolveDeployPlan(input({ service: gitService({ gitUrl: null }) })),
		).toThrow("No git repository URL configured.");
	});

	test("image source without an image", () => {
		expect(() =>
			resolveDeployPlan(input({ service: service({ image: "" }) })),
		).toThrow(DeployPlanError);
	});

	test("a build server without a cache registry", () => {
		expect(() =>
			resolveDeployPlan(
				input({
					buildServer: dockerServer,
					service: gitService({ buildServerRemoteHostId: "host-docker" }),
				}),
			),
		).toThrow("needs a build cache registry");
	});

	test("a build server that didn't resolve", () => {
		expect(() =>
			resolveDeployPlan(
				input({
					cacheRegistry: registry,
					service: gitService({ buildServerRemoteHostId: "gone" }),
				}),
			),
		).toThrow("Build server gone not found.");
	});

	test("host networking under swarm", () => {
		expect(() =>
			resolveDeployPlan(
				input({
					orchestrationMode: "swarm",
					service: service({ networkMode: "host" }),
				}),
			),
		).toThrow(DeployPlanError);
	});
});
