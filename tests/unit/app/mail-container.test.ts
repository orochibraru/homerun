import { describe, expect, mock, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { isPurgeablePath } = await import("../../../src/lib/mail");
const {
	acmeSourceFrom,
	mailBinds,
	mailConfigScript,
	mailEnv,
	acmeCertDomain,
	mailLabels,
	mailMatches,
} = await import("../../../src/lib/services/docker/mail-container");

const state = {
	certDomain: "mail.example.com",
	certSource: "/var/lib/docker/volumes/homerun_traefik_certs/_data",
	hostname: "mail.example.com",
	postmaster: "postmaster@example.com",
};

describe("acmeSourceFrom", () => {
	const mounts = [
		{
			Destination: "/letsencrypt",
			Name: "homerun_traefik_certs",
			Source: "/var/lib/docker/volumes/homerun_traefik_certs/_data",
			Type: "volume",
		},
		{ Destination: "/etc/traefik/dynamic", Source: "/srv/dyn", Type: "bind" },
	];

	test("finds the host directory holding the resolver's acme.json", () => {
		expect(
			acmeSourceFrom(
				[
					"--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json",
				],
				mounts,
				"letsencrypt",
			),
		).toBe("/var/lib/docker/volumes/homerun_traefik_certs/_data");
	});

	test("null when the storage isn't an acme.json at a mount's root", () => {
		expect(
			acmeSourceFrom(
				[
					"--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/certs/le.json",
				],
				mounts,
				"letsencrypt",
			),
		).toBeNull();
	});
});

describe("mail container", () => {
	test("rspamd on, the heavy filters off, TLS from acme.json", () => {
		const env = mailEnv(state);
		expect(env).toContain("ENABLE_RSPAMD=1");
		expect(env).toContain("ENABLE_CLAMAV=0");
		expect(env).toContain("SSL_TYPE=letsencrypt");
		expect(mailEnv({ ...state, certSource: null })).toContain("SSL_TYPE=");
	});

	test("only acme.json is mounted, read-only, so /etc/letsencrypt stays writable", () => {
		expect(mailBinds(state)).toContain(
			"/var/lib/docker/volumes/homerun_traefik_certs/_data/acme.json:/etc/letsencrypt/acme.json:ro",
		);
		expect(mailBinds({ ...state, certSource: null })).toHaveLength(4);
	});

	test("the router only exists to get a certificate", () => {
		const labels = mailLabels(state);
		expect(labels["traefik.http.routers.homerun-mail.rule"]).toBe(
			"Host(`mail.example.com`)",
		);
		expect(labels["traefik.http.routers.homerun-mail.service"]).toBe(
			"noop@internal",
		);
	});

	test("a hostname change means a recreate", () => {
		const env = mailEnv(state);
		const labels = mailLabels(state);
		const binds = mailBinds(state);
		expect(mailMatches(env, labels, binds, state)).toBe(true);
		expect(
			mailMatches(env, labels, binds, { ...state, hostname: "mx.example.com" }),
		).toBe(false);
		expect(mailMatches(env, labels, binds.slice(1), state)).toBe(false);
	});
});

describe("config writes and purges", () => {
	test("each file goes through a temp file and a rename", () => {
		const script = mailConfigScript([
			{ content: "x", path: "postfix-accounts.cf" },
		]);
		expect(script).toContain("printf '%s' \"$MAIL_FILE_0\"");
		expect(script).toContain(
			"mv '/cfg/postfix-accounts.cf.tmp' '/cfg/postfix-accounts.cf'",
		);
	});

	test("purges never climb out of the mail directory", () => {
		expect(isPurgeablePath("example.com")).toBe(true);
		expect(isPurgeablePath("example.com/jane.doe")).toBe(true);
		expect(isPurgeablePath("..")).toBe(false);
		expect(isPurgeablePath("example.com/..")).toBe(false);
		expect(isPurgeablePath("example.com/jane/x")).toBe(false);
		expect(isPurgeablePath("")).toBe(false);
	});
});

describe("acmeCertDomain", () => {
	const acme = (domains: { main: string; sans?: string[] }[]) =>
		JSON.stringify({
			letsencrypt: {
				Certificates: domains.map((domain) => ({ domain })),
			},
		});

	test("finds the certificate issued for the hostname", () => {
		expect(
			acmeCertDomain(
				acme([{ main: "app.example.com" }, { main: "mail.example.com" }]),
				"mail.example.com",
			),
		).toBe("mail.example.com");
	});

	test("a wildcard or SAN covering it gives that certificate's main name", () => {
		expect(
			acmeCertDomain(
				acme([{ main: "example.com", sans: ["*.example.com"] }]),
				"mail.example.com",
			),
		).toBe("example.com");
		expect(
			acmeCertDomain(acme([{ main: "*.example.com" }]), "mail.example.com"),
		).toBe("*.example.com");
	});

	test("none when nothing covers it or the file isn't JSON", () => {
		expect(
			acmeCertDomain(acme([{ main: "*.other.com" }]), "mail.example.com"),
		).toBeNull();
		expect(
			acmeCertDomain(acme([{ main: "*.example.com" }]), "a.mail.example.com"),
		).toBeNull();
		expect(acmeCertDomain("{}", "mail.example.com")).toBeNull();
		expect(acmeCertDomain("not json", "mail.example.com")).toBeNull();
	});

	test("without a certificate the mail server runs without TLS", () => {
		const env = mailEnv({ ...state, certDomain: null });
		expect(env).toContain("SSL_TYPE=");
		expect(mailBinds({ ...state, certDomain: null })).toHaveLength(4);
	});
});
