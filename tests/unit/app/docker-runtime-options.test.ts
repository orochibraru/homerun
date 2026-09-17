import { describe, expect, test } from "bun:test";
import { runtimeOptionsFrom } from "../../../src/lib/service-runtime";
import {
	capabilityName,
	deviceMappingFor,
	mergeLabels,
	runtimeArgv,
	runtimeHostConfig,
} from "../../../src/lib/services/docker/runtime-options";

describe("deviceMappingFor", () => {
	test("reads every short form docker run --device takes", () => {
		expect(deviceMappingFor("/dev/dri")).toEqual({
			CgroupPermissions: "rwm",
			PathInContainer: "/dev/dri",
			PathOnHost: "/dev/dri",
		});
		expect(deviceMappingFor("/dev/ttyUSB0:/dev/zigbee")).toEqual({
			CgroupPermissions: "rwm",
			PathInContainer: "/dev/zigbee",
			PathOnHost: "/dev/ttyUSB0",
		});
		expect(deviceMappingFor("/dev/snd:r")).toEqual({
			CgroupPermissions: "r",
			PathInContainer: "/dev/snd",
			PathOnHost: "/dev/snd",
		});
		expect(deviceMappingFor("/dev/a:/dev/b:rw").CgroupPermissions).toBe("rw");
	});
});

describe("runtime options", () => {
	test("capability names get the CAP_ prefix Docker expects", () => {
		expect(capabilityName("net_admin")).toBe("CAP_NET_ADMIN");
		expect(capabilityName("CAP_SYS_TIME")).toBe("CAP_SYS_TIME");
	});

	test("Homerun's own labels win over a custom one", () => {
		expect(
			mergeLabels(
				{ "com.example": "1", "homerun.service.id": "forged" },
				{ "homerun.service.id": "svc-1" },
			),
		).toEqual({ "com.example": "1", "homerun.service.id": "svc-1" });
	});

	test("leaves everything unset for a service with no overrides", () => {
		const defaults = runtimeOptionsFrom({});
		expect(runtimeArgv(defaults)).toEqual({
			Cmd: undefined,
			Entrypoint: undefined,
		});
		expect(runtimeHostConfig(defaults)).toEqual({
			CapAdd: undefined,
			Devices: undefined,
			Privileged: undefined,
		});
	});

	test("maps overrides onto the container create options", () => {
		const runtime = runtimeOptionsFrom({
			capAdd: ["NET_ADMIN"],
			command: ["--port", "80"],
			devices: ["/dev/dri"],
			entrypoint: ["/bin/sh", "-c"],
			privileged: true,
		});
		expect(runtimeArgv(runtime)).toEqual({
			Cmd: ["--port", "80"],
			Entrypoint: ["/bin/sh", "-c"],
		});
		expect(runtimeHostConfig(runtime)).toMatchObject({
			CapAdd: ["CAP_NET_ADMIN"],
			Devices: [{ PathOnHost: "/dev/dri" }],
			Privileged: true,
		});
	});
});
