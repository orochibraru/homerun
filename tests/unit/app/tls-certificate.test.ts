import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { certResolverFor } from "../../../src/lib/services/docker/cert-resolver";
import { tlsConfigYaml } from "../../../src/lib/services/docker/tls-config";
import {
	certificateCovers,
	inspectCertificate,
} from "../../../src/lib/tls-certificate";

/** A self-signed certificate and its key for `names`, made with openssl. */
function makeCertificate(names: string[], days = 30) {
	const dir = mkdtempSync(join(tmpdir(), "tls-"));
	const run = Bun.spawnSync([
		"openssl",
		"req",
		"-x509",
		"-newkey",
		"rsa:2048",
		"-nodes",
		"-keyout",
		join(dir, "key.pem"),
		"-out",
		join(dir, "cert.pem"),
		"-days",
		String(days),
		"-subj",
		`/O=Test Origin CA/CN=${names[0]}`,
		"-addext",
		`subjectAltName=${names.map((name) => `DNS:${name}`).join(",")}`,
	]);
	if (run.exitCode !== 0) {
		throw new Error(run.stderr.toString());
	}
	return {
		cert: readFileSync(join(dir, "cert.pem"), "utf8"),
		key: readFileSync(join(dir, "key.pem"), "utf8"),
	};
}

describe("inspectCertificate", () => {
	const pair = makeCertificate(["example.com", "*.example.com"]);

	test("reads the names, issuer and expiry of a matching pair", () => {
		const info = inspectCertificate(pair.cert, pair.key);
		expect(info.names).toEqual(["example.com", "*.example.com"]);
		expect(info.issuer).toBe("Test Origin CA");
		expect(info.expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	test("refuses garbage, a key from another certificate and an expired one", () => {
		const other = makeCertificate(["other.org"]);
		expect(() => inspectCertificate("nope", pair.key)).toThrow(
			"isn't a PEM certificate",
		);
		expect(() => inspectCertificate(pair.cert, "nope")).toThrow(
			"isn't a PEM private key",
		);
		expect(() => inspectCertificate(pair.cert, other.key)).toThrow(
			"doesn't belong",
		);
		expect(() =>
			inspectCertificate(pair.cert, pair.key, new Date("2200-01-01")),
		).toThrow("expired");
	});
});

describe("certificateCovers and the cert resolver", () => {
	const names = ["example.com", "*.example.com"];

	test("a wildcard covers one level, exact names only themselves", () => {
		expect(certificateCovers(names, "example.com")).toBe(true);
		expect(certificateCovers(names, "App.Example.com")).toBe(true);
		expect(certificateCovers(names, "a.b.example.com")).toBe(false);
		expect(certificateCovers(names, "example.org")).toBe(false);
		expect(certificateCovers([], "example.com")).toBe(false);
	});

	test("a covered host asks no resolver, others still do", () => {
		expect(certResolverFor("app.example.com", "le", false, names)).toBeNull();
		expect(certResolverFor("app.other.org", "le", false, names)).toBe("le");
	});
});

describe("tlsConfigYaml", () => {
	test("inlines the PEM, as the default certificate when asked", () => {
		const pair = {
			cert: "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----",
			key: "-----BEGIN PRIVATE KEY-----\nBBB\n-----END PRIVATE KEY-----",
		};
		const parsed = Bun.YAML.parse(
			tlsConfigYaml(pair, { asDefault: true, owner: "the instance" }),
		) as {
			tls: {
				certificates: { certFile: string; keyFile: string }[];
				stores: { default: { defaultCertificate: { certFile: string } } };
			};
		};
		expect(parsed.tls.certificates[0]?.keyFile).toBe(`${pair.key}\n`);
		expect(parsed.tls.stores.default.defaultCertificate.certFile).toBe(
			`${pair.cert}\n`,
		);
		expect(tlsConfigYaml(pair, { asDefault: false, owner: "x" })).not.toContain(
			"stores",
		);
	});
});
