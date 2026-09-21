import { describe, expect, test } from "bun:test";
import {
	CORE_HASH_LABEL,
	CORE_LABEL,
	NEWT_CONTAINER_NAME,
	newtContainerSpec,
	newtSwarmServiceSpec,
} from "$lib/services/docker/newt";

const credentials = {
	endpoint: "https://pangolin.example.com",
	id: "abc",
	secret: "s3cret",
};

describe("newtContainerSpec", () => {
	test("runs newt on the shared network with its credentials", () => {
		const spec = newtContainerSpec(credentials, "homerun");
		expect(spec.name).toBe(NEWT_CONTAINER_NAME);
		expect(spec.HostConfig?.NetworkMode).toBe("homerun");
		expect(spec.Env).toContain(
			"PANGOLIN_ENDPOINT=https://pangolin.example.com",
		);
		expect(spec.Env).toContain("NEWT_ID=abc");
		expect(spec.Env).toContain("NEWT_SECRET=s3cret");
		expect(spec.Labels?.[CORE_LABEL]).toBe("newt");
		expect(spec.Labels?.["homerun.managed"]).toBeUndefined();
	});

	test("the hash only changes when the container would", () => {
		const hash = (creds: typeof credentials, network = "homerun") =>
			newtContainerSpec(creds, network).Labels?.[CORE_HASH_LABEL];
		expect(hash(credentials)).toBe(hash({ ...credentials }));
		expect(hash(credentials)).not.toBe(hash({ ...credentials, secret: "x" }));
		expect(hash(credentials)).not.toBe(hash(credentials, "other"));
	});
});

describe("newtSwarmServiceSpec", () => {
	test("runs one newt task on the overlay, pinned to Traefik's node", () => {
		const spec = newtSwarmServiceSpec(credentials, "homerun-swarm", "node1");
		expect(spec.Name).toBe(NEWT_CONTAINER_NAME);
		expect(spec.Mode).toEqual({ Replicated: { Replicas: 1 } });
		expect(spec.TaskTemplate).toMatchObject({
			ContainerSpec: {
				Env: expect.arrayContaining(["NEWT_ID=abc", "NEWT_SECRET=s3cret"]),
				Labels: { [CORE_LABEL]: "newt" },
			},
			Networks: [{ Target: "homerun-swarm" }],
			Placement: { Constraints: ["node.id == node1"] },
			RestartPolicy: { Condition: "any" },
		});
		expect(spec.Labels[CORE_LABEL]).toBe("newt");
	});

	test("the hash tells a service from a container and one node from another", () => {
		const service = (nodeId: string) =>
			newtSwarmServiceSpec(credentials, "homerun-swarm", nodeId).Labels[
				CORE_HASH_LABEL
			];
		expect(service("node1")).toBe(service("node1"));
		expect(service("node1")).not.toBe(service("node2"));
		expect(service("node1")).not.toBe(
			newtContainerSpec(credentials, "homerun-swarm").Labels?.[CORE_HASH_LABEL],
		);
	});
});
