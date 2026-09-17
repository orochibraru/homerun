import { describe, expect, test } from "bun:test";
import {
	hostAccessChanged,
	hostAccessRequested,
	templateHostAccessMessage,
	templatesNeedingHostAccess,
} from "../../../src/lib/host-access";
import { runtimeOptionsSummary } from "../../../src/lib/service-runtime";

describe("host access gate", () => {
	test("a service asking for nothing host-level passes", () => {
		expect(hostAccessRequested({})).toBe(false);
		expect(
			hostAccessRequested({
				capAdd: [],
				devices: [],
				envFiles: [],
				privileged: false,
			}),
		).toBe(false);
	});

	test("each host-level option alone needs an admin", () => {
		expect(hostAccessRequested({ privileged: true })).toBe(true);
		expect(hostAccessRequested({ capAdd: ["NET_ADMIN"] })).toBe(true);
		expect(hostAccessRequested({ devices: ["/dev/dri"] })).toBe(true);
		expect(hostAccessRequested({ envFiles: ["/opt/app.env"] })).toBe(true);
	});

	test("an update that keeps the current values, or leaves them out, isn't a change", () => {
		const current = {
			capAdd: ["NET_ADMIN"],
			devices: [],
			envFiles: ["/opt/app.env"],
			privileged: true,
		};
		expect(hostAccessChanged(current, {})).toBe(false);
		expect(hostAccessChanged(current, { ...current })).toBe(false);
		expect(hostAccessChanged(current, { privileged: true })).toBe(false);
	});

	test("adding, removing or reordering a host-level value is a change", () => {
		const current = { capAdd: ["A", "B"], privileged: false };
		expect(hostAccessChanged(current, { privileged: true })).toBe(true);
		expect(hostAccessChanged(current, { capAdd: ["A"] })).toBe(true);
		expect(hostAccessChanged(current, { capAdd: ["B", "A"] })).toBe(true);
		expect(hostAccessChanged(current, { devices: ["/dev/dri"] })).toBe(true);
		expect(hostAccessChanged({}, { envFiles: [] })).toBe(false);
	});

	test("a template deploy names the primary and every companion that needs host access", () => {
		expect(
			templatesNeedingHostAccess([
				{ name: "App" },
				{ devices: ["/dev/dri"], name: "Transcoder" },
				{ capAdd: [], envFiles: [], name: "Cache", privileged: false },
				{ name: "Vpn", privileged: true },
			]),
		).toEqual(["Transcoder", "Vpn"]);
		expect(templatesNeedingHostAccess([{ name: "Plain" }])).toEqual([]);
	});

	test("the template refusal names what needs an admin", () => {
		expect(templateHostAccessMessage(["Vpn"])).toBe(
			'"Vpn" needs host access (privileged mode, devices, added capabilities or env files) : only an admin can deploy it.',
		);
		expect(templateHostAccessMessage(["Vpn", "Transcoder"])).toContain(
			'"Vpn", "Transcoder" need host access',
		);
	});
});

describe("runtime options summary", () => {
	test("lists nothing for a template left at the image's defaults", () => {
		expect(runtimeOptionsSummary({})).toEqual([]);
		expect(runtimeOptionsSummary(null)).toEqual([]);
	});

	test("lists each override, quoting argv like a shell would", () => {
		expect(
			runtimeOptionsSummary({
				capAdd: ["NET_ADMIN"],
				command: ["sh", "-c", "echo hi"],
				devices: ["/dev/dri"],
				entrypoint: ["/init"],
				envFiles: ["/opt/app.env"],
				labels: { a: "1", b: "2" },
				privileged: true,
			}),
		).toEqual([
			"Entrypoint: /init",
			"Command: sh -c 'echo hi'",
			"2 labels",
			"Env files: /opt/app.env",
			"Added capabilities: NET_ADMIN",
			"Devices: /dev/dri",
			"Runs privileged",
		]);
	});
});
