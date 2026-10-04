import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";

mock.module("$app/env", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { DomainDnsService, recordFor } = await import(
	"../../../src/lib/services/domain-dns.service"
);
const { DomainDTO } = await import("../../../src/lib/dto/domain-dto");
const { DnsConnectionDTO } = await import(
	"../../../src/lib/dto/dns-connection-dto"
);
const { DnsManagedRecordDTO } = await import(
	"../../../src/lib/dto/dns-managed-record-dto"
);

import type {
	DnsProviderClient,
	DnsRecord,
} from "../../../src/lib/services/dns-providers/types";

const restorers: { mockRestore: () => void }[] = [];

afterEach(() => {
	for (const spy of restorers.splice(0)) {
		spy.mockRestore();
	}
});

/** An in-memory provider holding `records`. */
function fakeProvider(records: DnsRecord[]): DnsProviderClient {
	let next = 100;
	return {
		async createRecord(_zone, input) {
			const record = {
				content: input.content,
				id: `r${next++}`,
				name: input.name,
				priority: null,
				ttl: null,
				type: input.type,
			};
			records.push(record);
			return record;
		},
		async deleteRecord(_zone, record) {
			const index = records.findIndex(
				(candidate) => candidate.id === record.id,
			);
			if (index >= 0) {
				records.splice(index, 1);
			}
		},
		async listRecords() {
			return [...records];
		},
		async listZones() {
			return [{ id: "z1", name: "example.com" }];
		},
		async updateRecord(_zone, record, input) {
			const stored = records.find((candidate) => candidate.id === record.id);
			if (stored) {
				stored.content = input.content;
			}
			return { ...record, content: input.content };
		},
	};
}

/** Wires one managed domain `example.com`, pointing at `target`, over `records`, with an in-memory tracking table. */
function setup(
	records: DnsRecord[],
	target: string | null = "203.0.113.10",
	autoRecords = true,
) {
	const tracked = new Map<string, DnsRecord>();
	const domain = {
		connectionId: "c1",
		id: "d1",
		name: "example.com",
		toJSON: () => ({
			autoRecords,
			connectionId: "c1",
			id: "d1",
			name: "example.com",
			target,
			zoneId: "z1",
			zoneName: "example.com",
		}),
		zone: () => ({ id: "z1", name: "example.com" }),
	} as never;
	restorers.push(
		spyOn(DomainDTO, "forHostname").mockImplementation(async (host: string) =>
			host === "example.com" || host.endsWith(".example.com") ? domain : null,
		),
		spyOn(DnsConnectionDTO, "get").mockResolvedValue({
			client: () => fakeProvider(records),
			name: "Cloudflare",
		} as never),
		spyOn(DnsManagedRecordDTO, "find").mockImplementation(
			async (_domainId: string, name: string) => {
				const record = tracked.get(name);
				return record
					? ({
							asRecord: () => record,
							untrack: async () => tracked.delete(name),
						} as never)
					: null;
			},
		),
		spyOn(DnsManagedRecordDTO, "track").mockImplementation(
			async (_domainId: string, record: DnsRecord) => {
				tracked.set(record.name, record);
			},
		),
		spyOn(DnsManagedRecordDTO, "listForDomain").mockImplementation(async () =>
			[...tracked.values()].map(
				(record) => ({ asRecord: () => record }) as never,
			),
		),
	);
	return { domain, tracked };
}

describe("recordFor", () => {
	test("an IP gives an A or AAAA record, a hostname a CNAME, never on the apex or itself", () => {
		expect(recordFor("App.example.com", "203.0.113.10", "example.com")).toEqual(
			{ content: "203.0.113.10", name: "app.example.com", type: "A" },
		);
		expect(
			recordFor("app.example.com", "2001:db8::1", "example.com")?.type,
		).toBe("AAAA");
		expect(
			recordFor("app.example.com", "Host.Example.net.", "example.com"),
		).toEqual({
			content: "host.example.net",
			name: "app.example.com",
			type: "CNAME",
		});
		expect(
			recordFor("example.com", "host.example.net", "example.com"),
		).toBeNull();
		expect(
			recordFor("host.example.net", "host.example.net", "example.net"),
		).toBeNull();
	});
});

describe("DomainDnsService.syncHostname", () => {
	test("creates a record for a new hostname and tracks it, then leaves it as is", async () => {
		const records: DnsRecord[] = [];
		const { tracked } = setup(records);
		expect(
			await DomainDnsService.syncHostname("app.example.com"),
		).toMatchObject({
			detail: "created A → 203.0.113.10",
			ok: true,
			provider: "Cloudflare",
		});
		expect(tracked.has("app.example.com")).toBe(true);
		expect(
			await DomainDnsService.syncHostname("app.example.com"),
		).toMatchObject({ detail: "A 203.0.113.10 (unchanged)" });
		expect(records).toHaveLength(1);
	});

	test("fixes the record it created when the target changes", async () => {
		const records: DnsRecord[] = [];
		setup(records);
		await DomainDnsService.syncHostname("app.example.com");
		restorers.splice(0).forEach((spy) => spy.mockRestore());
		setup(records, "198.51.100.7");
		const tracked = records[0] as DnsRecord;
		spyOn(DnsManagedRecordDTO, "find").mockResolvedValue({
			asRecord: () => tracked,
		} as never);
		expect(
			await DomainDnsService.syncHostname("app.example.com"),
		).toMatchObject({ detail: "updated A → 198.51.100.7" });
		expect(records[0]?.content).toBe("198.51.100.7");
	});

	test("never touches a record someone made by hand", async () => {
		const records: DnsRecord[] = [
			{
				content: "192.0.2.1",
				id: "hand",
				name: "app.example.com",
				priority: null,
				ttl: null,
				type: "A",
			},
		];
		setup(records);
		expect(
			await DomainDnsService.syncHostname("app.example.com"),
		).toMatchObject({ ok: false });
		expect(records).toEqual([
			{
				content: "192.0.2.1",
				id: "hand",
				name: "app.example.com",
				priority: null,
				ttl: null,
				type: "A",
			},
		]);
	});

	test("does nothing for a hostname outside every domain or with automation off", async () => {
		setup([], "203.0.113.10", false);
		expect(await DomainDnsService.syncHostname("app.example.com")).toBeNull();
		expect(await DomainDnsService.syncHostname("app.other.org")).toBeNull();
	});
});

describe("DomainDnsService.deleteHostname and pointAtServer", () => {
	test("deletes only the records it created", async () => {
		const records: DnsRecord[] = [];
		setup(records);
		await DomainDnsService.syncHostname("app.example.com");
		records.push({
			content: "192.0.2.1",
			id: "hand",
			name: "mail.example.com",
			priority: null,
			ttl: null,
			type: "A",
		});
		expect(
			await DomainDnsService.deleteHostname("app.example.com"),
		).toMatchObject({ detail: "deleted", ok: true });
		expect(
			await DomainDnsService.deleteHostname("mail.example.com"),
		).toBeNull();
		expect(records.map((record) => record.id)).toEqual(["hand"]);
	});

	test("points the apex and a wildcard at an IP, skipping what's already there", async () => {
		const records: DnsRecord[] = [];
		const { domain } = setup(records);
		expect(await DomainDnsService.pointAtServer(domain)).toEqual([
			"example.com: created A → 203.0.113.10",
			"*.example.com: created A → 203.0.113.10",
		]);
		expect(await DomainDnsService.pointAtServer(domain)).toEqual([
			"example.com: already A 203.0.113.10",
			"*.example.com: already A 203.0.113.10",
		]);
	});

	test("a hostname target can't go on the apex", async () => {
		const { domain } = setup([], "server.example.net");
		expect(await DomainDnsService.pointAtServer(domain)).toEqual([
			"example.com: needs an IP target (a CNAME can't sit on the apex)",
			"*.example.com: created CNAME → server.example.net",
		]);
	});
});

describe("DomainDnsService manual record edits", () => {
	const hand = (): DnsRecord => ({
		content: "192.0.2.1",
		id: "hand",
		name: "mail.example.com",
		priority: null,
		ttl: null,
		type: "A",
	});

	test("lists the domain's records with which ones Homerun made, sorted", async () => {
		const records: DnsRecord[] = [
			hand(),
			{ ...hand(), id: "other", name: "x.other.org" },
		];
		const { domain } = setup(records);
		await DomainDnsService.syncHostname("app.example.com");
		expect(
			(await DomainDnsService.records(domain)).map((r) => [r.name, r.managed]),
		).toEqual([
			["app.example.com", true],
			["mail.example.com", false],
		]);
	});

	test("creates, updates and deletes by hand, keeping tracking in step", async () => {
		const records: DnsRecord[] = [];
		const { domain, tracked } = setup(records);
		await DomainDnsService.syncHostname("app.example.com");
		const created = await DomainDnsService.createRecord(domain, {
			content: "hello",
			name: "txt.example.com",
			type: "TXT",
		});
		expect(tracked.has("txt.example.com")).toBe(false);
		await expect(
			DomainDnsService.createRecord(domain, {
				content: "x",
				name: "a.other.org",
				type: "TXT",
			}),
		).rejects.toThrow("isn't under example.com");

		const managedId = tracked.get("app.example.com")?.id as string;
		await DomainDnsService.updateRecord(domain, managedId, {
			content: "198.51.100.9",
			name: "app.example.com",
			type: "A",
		});
		expect(tracked.get("app.example.com")?.content).toBe("198.51.100.9");
		await DomainDnsService.updateRecord(domain, created.id, {
			content: "bye",
			name: "txt.example.com",
			type: "TXT",
		});
		await expect(
			DomainDnsService.updateRecord(domain, "gone", {
				content: "x",
				name: "app.example.com",
				type: "A",
			}),
		).rejects.toThrow("doesn't exist");

		await DomainDnsService.deleteRecord(domain, managedId);
		await DomainDnsService.deleteRecord(domain, created.id);
		await DomainDnsService.deleteRecord(domain, "gone");
		expect(records).toEqual([]);
		expect(tracked.size).toBe(0);
	});

	test("refuses to edit a domain with no linked zone", async () => {
		const { domain } = setup([], null);
		restorers.push(spyOn(DnsConnectionDTO, "get").mockResolvedValue(null));
		await expect(DomainDnsService.records(domain)).rejects.toThrow(
			"Link the domain",
		);
		await expect(DomainDnsService.pointAtServer(domain)).rejects.toThrow(
			"Link the domain",
		);
	});

	test("a domain with no target reports it, a hand record matching the target is fine", async () => {
		const { config } = await import("../../../src/lib/config");
		const base = config.baseDomain;
		config.baseDomain = "";
		try {
			setup([], null);
			expect(
				await DomainDnsService.syncHostname("app.example.com"),
			).toMatchObject({ ok: false });
		} finally {
			config.baseDomain = base;
		}
		restorers.splice(0).forEach((spy) => spy.mockRestore());
		setup([{ ...hand(), name: "app.example.com", content: "203.0.113.10" }]);
		expect(
			await DomainDnsService.syncHostname("app.example.com"),
		).toMatchObject({ ok: true, detail: expect.stringContaining("already") });
		restorers.splice(0).forEach((spy) => spy.mockRestore());
		setup([], "example.com");
		expect(await DomainDnsService.syncHostname("example.com")).toMatchObject({
			detail: expect.stringContaining("left alone"),
		});
	});
});
