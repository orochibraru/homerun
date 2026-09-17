import { describe, expect, test } from "bun:test";
import {
	isMirrorRef,
	registryAuthFileFor,
	skopeoCopyCommand,
} from "$lib/services/docker/image-scan-refs";

describe("registryAuthFileFor", () => {
	test("covers the upstream registry and the mirror in one file", () => {
		// What a mirror copy needs once the built-in registry has auth on: skopeo
		// authenticating against both ends of the same copy.
		const file = JSON.parse(
			registryAuthFileFor([
				{
					credentials: { password: "hub-pass", username: "hub-user" },
					registry: "docker.io",
				},
				{
					credentials: {
						password: "mirror-pass",
						username: "homerun-internal",
					},
					registry: "homerun-mirror:5000",
				},
			]),
		);
		expect(Object.keys(file.auths).sort()).toEqual([
			"docker.io",
			"homerun-mirror:5000",
			"index.docker.io",
		]);
		expect(
			Buffer.from(file.auths["homerun-mirror:5000"].auth, "base64").toString(),
		).toBe("homerun-internal:mirror-pass");
	});

	test("Docker Hub is keyed under both names tools address it by", () => {
		const file = JSON.parse(
			registryAuthFileFor([
				{
					credentials: { password: "p", username: "u" },
					registry: "docker.io",
				},
			]),
		);
		expect(file.auths["docker.io"]).toEqual(file.auths["index.docker.io"]);
	});
});

describe("isMirrorRef", () => {
	test("recognises both addresses the registry answers on", () => {
		expect(isMirrorRef("homerun-mirror:5000/docker.io/library/nginx:1")).toBe(
			true,
		);
		expect(isMirrorRef("127.0.0.1:5055/docker.io/library/nginx:1")).toBe(true);
	});

	test("an upstream ref is not a mirror ref", () => {
		expect(isMirrorRef("docker.io/library/nginx:1")).toBe(false);
		expect(isMirrorRef("ghcr.io/homerun/app:latest")).toBe(false);
	});
});

describe("skopeoCopyCommand", () => {
	test("no credentials at all runs skopeo directly", () => {
		const command = skopeoCopyCommand({
			destination: "homerun-mirror:5000/x:1",
			source: "docker.io/library/x:1",
			withAuth: false,
		});
		expect(command.entrypoint).toEqual(["skopeo"]);
		expect(command.cmd.join(" ")).not.toContain("authfile");
	});

	test("the destination can be authenticated on its own", () => {
		const command = skopeoCopyCommand({
			destAuth: true,
			destination: "homerun-mirror:5000/x:1",
			source: "docker.io/library/x:1",
			withAuth: false,
		});
		expect(command.cmd).toContain("--dest-authfile");
		expect(command.cmd).not.toContain("--src-authfile");
		// Credentials reach skopeo through a file written from an env var, never
		// as CLI args, where docker inspect would show them.
		expect(command.entrypoint[0]).toBe("sh");
	});

	test("both ends can be authenticated from the same file", () => {
		const command = skopeoCopyCommand({
			destAuth: true,
			destination: "homerun-mirror:5000/x:1",
			source: "private.example.com/x:1",
			withAuth: true,
		});
		expect(command.cmd).toContain("--src-authfile");
		expect(command.cmd).toContain("--dest-authfile");
		expect(command.cmd.filter((arg) => arg === "/tmp/auth.json").length).toBe(
			2,
		);
	});
});
