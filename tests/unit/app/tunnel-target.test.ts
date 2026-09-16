import { describe, expect, test } from "bun:test";
import { tunnelTargetHostFrom } from "../../../src/lib/services/docker/tunnel";

const traefik = {
	Image: "traefik:v3",
	Names: ["/homerun-traefik-1"],
	NetworkSettings: { Networks: { homerun: {} } },
};

describe("tunnelTargetHostFrom", () => {
	test("targets Traefik by container name when newt is a container on its network", () => {
		const newt = {
			Image: "fosrl/newt:latest",
			Names: ["/homerun-newt-1"],
			NetworkSettings: { Networks: { homerun: {} } },
		};
		expect(tunnelTargetHostFrom([newt, traefik])).toBe("homerun-traefik-1");
	});

	test("uses localhost when newt runs with host networking", () => {
		const newt = {
			HostConfig: { NetworkMode: "host" },
			Image: "docker.io/fosrl/newt:1.5.0",
			Names: ["/newt"],
			NetworkSettings: { Networks: { host: {} } },
		};
		expect(tunnelTargetHostFrom([newt, traefik])).toBe("localhost");
	});

	test("uses localhost when newt isn't a container on this host", () => {
		expect(tunnelTargetHostFrom([traefik])).toBe("localhost");
	});

	test("uses localhost when newt and Traefik share no network", () => {
		const newt = {
			Image: "fosrl/newt",
			Names: ["/newt"],
			NetworkSettings: { Networks: { other: {} } },
		};
		expect(tunnelTargetHostFrom([newt, traefik])).toBe("localhost");
	});
});
