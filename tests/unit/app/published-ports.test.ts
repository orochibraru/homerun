import { describe, expect, test } from "bun:test";

import {
	exposedPortsProblem,
	portBindings,
	publishedPortsProblem,
} from "#lib/published-ports.js";

describe("exposedPortsProblem", () => {
	test("accepts distinct ports, and the same number on both protocols", () => {
		expect(
			exposedPortsProblem([
				{ port: 53, protocol: "tcp" },
				{ port: 53, protocol: "udp" },
				{ port: 8088, protocol: "tcp" },
			]),
		).toBeNull();
	});

	test("refuses a port listed twice", () => {
		expect(
			exposedPortsProblem([
				{ port: 8088, protocol: "tcp" },
				{ port: 8088, protocol: "tcp" },
			]),
		).toBe("Exposed port 8088/tcp is listed twice.");
	});

	test("refuses a port outside 1-65535", () => {
		expect(exposedPortsProblem([{ port: 0, protocol: "tcp" }])).toBe(
			"Exposed port 0/tcp is outside 1-65535.",
		);
		expect(exposedPortsProblem([{ port: 70_000, protocol: "udp" }])).toBe(
			"Exposed port 70000/udp is outside 1-65535.",
		);
	});
});

describe("portBindings", () => {
	test("binds each host port under its container port and protocol", () => {
		expect(
			portBindings([
				{ containerPort: 22, hostPort: 2222, protocol: "tcp" },
				{ containerPort: 1194, hostPort: 1194, protocol: "udp" },
				{ containerPort: 22, hostPort: 2223, protocol: "tcp" },
			]),
		).toEqual({
			"1194/udp": [{ HostPort: "1194" }],
			"22/tcp": [{ HostPort: "2222" }, { HostPort: "2223" }],
		});
	});

	test("leaves the create body alone when nothing is published", () => {
		expect(portBindings([])).toBeUndefined();
	});
});

describe("publishedPortsProblem", () => {
	test("accepts distinct ports, and the same number on both protocols", () => {
		expect(
			publishedPortsProblem([
				{ containerPort: 53, hostPort: 53, protocol: "tcp" },
				{ containerPort: 53, hostPort: 53, protocol: "udp" },
			]),
		).toBeNull();
	});

	test("refuses Traefik's TCP ports and its HTTP/3 port, but not UDP 80", () => {
		expect(
			publishedPortsProblem([
				{ containerPort: 8443, hostPort: 443, protocol: "tcp" },
			]),
		).toContain("Traefik");
		expect(
			publishedPortsProblem([
				{ containerPort: 443, hostPort: 443, protocol: "udp" },
			]),
		).toContain("Traefik");
		expect(
			publishedPortsProblem([
				{ containerPort: 80, hostPort: 80, protocol: "udp" },
			]),
		).toBeNull();
	});

	test("refuses the same host port and protocol twice", () => {
		expect(
			publishedPortsProblem([
				{ containerPort: 1, hostPort: 2222, protocol: "tcp" },
				{ containerPort: 2, hostPort: 2222, protocol: "tcp" },
			]),
		).toContain("twice");
	});
});
