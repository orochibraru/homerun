import { describe, expect, test } from "bun:test";
import {
	CORE_HASH_LABEL,
	CORE_LABEL,
	NEWT_CONTAINER_NAME,
	newtContainerSpec,
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
