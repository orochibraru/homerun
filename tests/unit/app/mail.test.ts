import { describe, expect, test } from "bun:test";

const {
	dkimKeyPath,
	dkimSigningConf,
	dovecotQuotas,
	isMailAddress,
	isMailboxKind,
	joinTxtStrings,
	localPartProblem,
	mailAddress,
	mailPasswordProblem,
	mailRecordState,
	mailRelayProblem,
	parseDestinations,
	postfixAccounts,
	postfixReceiveAccess,
	postfixVirtual,
	requiredMailRecords,
} = await import("../../../src/lib/mail");

const records = requiredMailRecords("example.com", "mail.example.com", {
	publicKey: "MIIBIjAN",
	selector: "mail",
});
const [mx, spf, dkim, dmarc] = records;

describe("mail addresses", () => {
	test("a catch-all is @domain", () => {
		expect(mailAddress("", "example.com")).toBe("@example.com");
		expect(mailAddress("jane", "example.com")).toBe("jane@example.com");
	});

	test("local parts are lowercase and can't start or end with a symbol", () => {
		expect(localPartProblem("jane.doe+news")).toBeNull();
		expect(localPartProblem(".jane")).not.toBeNull();
		expect(localPartProblem("Jane")).not.toBeNull();
		expect(localPartProblem("")).not.toBeNull();
		expect(localPartProblem("", true)).toBeNull();
	});

	test("destinations are split, lowercased and deduplicated", () => {
		expect(parseDestinations("A@x.org, b@y.org\na@x.org")).toEqual([
			"a@x.org",
			"b@y.org",
		]);
		expect(isMailAddress("a@x.org")).toBe(true);
		expect(isMailAddress("a@x")).toBe(false);
	});

	test("passwords past bcrypt's 72 bytes are refused, not cut", () => {
		expect(mailPasswordProblem("short")).not.toBeNull();
		expect(mailPasswordProblem("a".repeat(72))).toBeNull();
		expect(mailPasswordProblem("a".repeat(73))).not.toBeNull();
	});
});

describe("docker-mailserver config files", () => {
	const boxes = [
		{ address: "jane@example.com", passwordHash: "$2y$10$abc", quotaMb: 500 },
		{ address: "joe@example.com", passwordHash: "$2y$10$def", quotaMb: null },
	];

	test("accounts carry the BLF-CRYPT scheme", () => {
		expect(postfixAccounts(boxes)).toBe(
			"jane@example.com|{BLF-CRYPT}$2y$10$abc\njoe@example.com|{BLF-CRYPT}$2y$10$def\n",
		);
	});

	test("only mailboxes with a quota get a quota line", () => {
		expect(dovecotQuotas(boxes)).toBe("jane@example.com:500M\n");
	});

	test("aliases with no destination are dropped", () => {
		expect(
			postfixVirtual([
				{ destinations: ["a@x.org", "b@y.org"], source: "hi@example.com" },
				{ destinations: [], source: "@example.com" },
			]),
		).toBe("hi@example.com a@x.org,b@y.org\n");
	});

	test("noreply addresses refuse incoming mail", () => {
		expect(postfixReceiveAccess(["noreply@example.com"])).toBe(
			"noreply@example.com REJECT This address doesn't receive mail\n",
		);
		expect(postfixReceiveAccess([])).toBe("");
		expect(isMailboxKind("noreply")).toBe(true);
		expect(isMailboxKind("other")).toBe(false);
	});

	test("rspamd finds each domain's key by selector and domain", () => {
		expect(dkimKeyPath("example.com", "mail")).toBe(
			"rspamd/dkim/rsa-2048-mail-example.com.private.txt",
		);
		expect(dkimSigningConf("/tmp/docker-mailserver")).toContain(
			'path = "/tmp/docker-mailserver/rspamd/dkim/rsa-2048-$selector-$domain.private.txt";',
		);
	});
});

describe("mailRelayProblem", () => {
	const relay = {
		host: "smtp.relay.test",
		password: "secret",
		port: 587,
		user: "apikey",
	};

	test("a hostname, a port and both credentials or neither", () => {
		expect(mailRelayProblem(relay)).toBeNull();
		expect(
			mailRelayProblem({ ...relay, password: null, user: null }),
		).toBeNull();
		expect(mailRelayProblem({ ...relay, host: "not a host" })).not.toBeNull();
		expect(mailRelayProblem({ ...relay, port: 70_000 })).not.toBeNull();
		expect(mailRelayProblem({ ...relay, password: null })).not.toBeNull();
	});
});

describe("mailRecordState", () => {
	test("records point at the mail host and publish the key", () => {
		expect(mx?.content).toBe("mail.example.com");
		expect(dkim?.name).toBe("mail._domainkey.example.com");
		expect(dkim?.content).toBe("v=DKIM1; k=rsa; p=MIIBIjAN");
		expect(dmarc?.name).toBe("_dmarc.example.com");
	});

	test("MX: ok, elsewhere or missing", () => {
		if (!mx) {
			throw new Error("no MX");
		}
		expect(mailRecordState(mx, ["mail.example.com."])).toBe("ok");
		expect(mailRecordState(mx, ["mx.other.net"])).toBe("different");
		expect(mailRecordState(mx, [])).toBe("missing");
	});

	test("SPF: any SPF with the mx mechanism will do", () => {
		if (!spf) {
			throw new Error("no SPF");
		}
		expect(mailRecordState(spf, ["v=spf1 mx include:_spf.x.net -all"])).toBe(
			"ok",
		);
		expect(
			mailRecordState(spf, ["v=spf1 include:_spf.mx.cloudflare.net ~all"]),
		).toBe("different");
		expect(mailRecordState(spf, ["google-site-verification=x"])).toBe(
			"missing",
		);
	});

	test("DKIM: whitespace in a split TXT value doesn't matter", () => {
		if (!dkim) {
			throw new Error("no DKIM");
		}
		expect(mailRecordState(dkim, ["v=DKIM1;  k=rsa; p=MIIB IjAN"])).toBe("ok");
		expect(mailRecordState(dkim, ["v=DKIM1; k=rsa; p=OTHER"])).toBe(
			"different",
		);
	});
});

describe("joinTxtStrings", () => {
	test("glues a long record Bun split at 255 characters back together", () => {
		const head = "a".repeat(255);
		expect(joinTxtStrings([[head], ["tail"], ["v=spf1 mx -all"]])).toEqual([
			`${head}tail`,
			"v=spf1 mx -all",
		]);
	});

	test("keeps separate records and joins one record's strings", () => {
		expect(joinTxtStrings([["v=spf1", " mx"], ["other"]])).toEqual([
			"v=spf1 mx",
			"other",
		]);
	});
});
