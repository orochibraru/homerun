import { afterEach, describe, expect, test } from "bun:test";
import { namecheap } from "../../../../src/lib/services/dns-providers/namecheap";
import { stubFetch } from "./stub-fetch";

const zone = { id: "example.co.uk", name: "example.co.uk" };
const API = "https://api.namecheap.com/xml.response";
const auth = "ApiKey=key&ApiUser=me&ClientIp=203.0.113.10&UserName=me";
const client = () =>
	namecheap.create({
		apiKey: "key",
		apiUser: "me",
		clientIp: "203.0.113.10",
	});
const ok = (command: string, body: string) => ({
	raw: `<?xml version="1.0" encoding="UTF-8"?><ApiResponse xmlns="http://api.namecheap.com/xml.response" Status="OK"><Errors /><RequestedCommand>${command}</RequestedCommand><CommandResponse Type="${command}">${body}</CommandResponse></ApiResponse>`,
	status: 200,
});
const hosts = (emailType: string, entries: string) =>
	ok(
		"namecheap.domains.dns.getHosts",
		`<DomainDNSGetHostsResult Domain="example.co.uk" EmailType="${emailType}" IsUsingOurDNS="true">${entries}</DomainDNSGetHostsResult>`,
	);
const setOk = ok(
	"namecheap.domains.dns.setHosts",
	'<DomainDNSSetHostsResult Domain="example.co.uk" IsSuccess="true"><Warnings /></DomainDNSSetHostsResult>',
);

afterEach(() => stubFetch.restore());

describe("Namecheap", () => {
	test("pages the domain list, skipping domains not on Namecheap DNS", async () => {
		const calls = stubFetch((request) => {
			const page = new URL(request.url).searchParams.get("Page");
			return ok(
				"namecheap.domains.getList",
				`<DomainGetListResult>${
					page === "1"
						? '<Domain ID="1" Name="Example.co.uk" IsOurDNS="true" /><Domain ID="2" Name="elsewhere.com" IsOurDNS="false" />'
						: '<Domain ID="3" Name="other.org" IsOurDNS="true" />'
				}</DomainGetListResult><Paging><TotalItems>150</TotalItems><CurrentPage>${page}</CurrentPage><PageSize>100</PageSize></Paging>`,
			);
		});
		expect(await client().listZones()).toEqual([
			{ id: "Example.co.uk", name: "example.co.uk" },
			{ id: "other.org", name: "other.org" },
		]);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}?${auth}&Command=namecheap.domains.getList&ListType=ALL&Page=1&PageSize=100`,
			`${API}?${auth}&Command=namecheap.domains.getList&ListType=ALL&Page=2&PageSize=100`,
		]);
	});

	test("reads hosts with the SLD/TLD split of a multi-part TLD", async () => {
		const calls = stubFetch(() =>
			hosts(
				"MX",
				'<host HostId="1" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1799" /><host HostId="2" Name="www" Type="CNAME" Address="example.co.uk." MXPref="10" TTL="300" /><host HostId="3" Name="@" Type="MX" Address="mx.example.net." MXPref="5" TTL="1799" /><host HostId="4" Name="@" Type="TXT" Address="v=spf1 &quot;x&quot; -all" MXPref="10" TTL="1800" />',
			),
		);
		expect(await client().listRecords(zone)).toEqual([
			{
				content: "1.2.3.4",
				id: "A:example.co.uk::1.2.3.4",
				name: "example.co.uk",
				priority: null,
				ttl: null,
				type: "A",
			},
			{
				content: "example.co.uk",
				id: "CNAME:www.example.co.uk::example.co.uk",
				name: "www.example.co.uk",
				priority: null,
				ttl: 300,
				type: "CNAME",
			},
			{
				content: "mx.example.net",
				id: "MX:example.co.uk:5:mx.example.net",
				name: "example.co.uk",
				priority: 5,
				ttl: null,
				type: "MX",
			},
			{
				content: 'v=spf1 "x" -all',
				id: 'TXT:example.co.uk::v=spf1 "x" -all',
				name: "example.co.uk",
				priority: null,
				ttl: 1800,
				type: "TXT",
			},
		]);
		expect(calls[0]?.url).toBe(
			`${API}?${auth}&Command=namecheap.domains.dns.getHosts&SLD=example&TLD=co.uk`,
		);
	});

	test("create, update and delete read every host and write them all back", async () => {
		const existing =
			'<host HostId="1" Name="@" Type="A" Address="1.2.3.4" MXPref="10" TTL="1799" /><host HostId="2" Name="www" Type="CNAME" Address="example.co.uk." MXPref="10" TTL="300" />';
		const calls = stubFetch((request) =>
			request.method === "POST" ? setOk : hosts("FWD", existing),
		);
		const created = await client().createRecord(zone, {
			content: "mx.example.net",
			name: "example.co.uk",
			priority: 20,
			type: "MX",
		});
		expect(created.id).toBe("MX:example.co.uk:20:mx.example.net");
		expect(calls[1]?.method).toBe("POST");
		expect(calls[1]?.url).toBe(API);
		expect(calls[1]?.headers.get("content-type")).toBe(
			"application/x-www-form-urlencoded",
		);
		expect(
			Object.fromEntries(new URLSearchParams(calls[1]?.body ?? "")),
		).toEqual({
			Address1: "1.2.3.4",
			Address2: "example.co.uk.",
			Address3: "mx.example.net",
			ApiKey: "key",
			ApiUser: "me",
			ClientIp: "203.0.113.10",
			Command: "namecheap.domains.dns.setHosts",
			EmailType: "MX",
			HostName1: "@",
			HostName2: "www",
			HostName3: "@",
			MXPref1: "10",
			MXPref2: "10",
			MXPref3: "20",
			RecordType1: "A",
			RecordType2: "CNAME",
			RecordType3: "MX",
			SLD: "example",
			TLD: "co.uk",
			TTL1: "1799",
			TTL2: "300",
			TTL3: "1799",
			UserName: "me",
		});
		await client().updateRecord(
			zone,
			{
				content: "example.co.uk",
				id: "CNAME:www.example.co.uk::example.co.uk",
				name: "www.example.co.uk",
				priority: null,
				ttl: 300,
				type: "CNAME",
			},
			{ content: "1.1.1.1", name: "www.example.co.uk", ttl: 60, type: "A" },
		);
		const update = new URLSearchParams(calls[3]?.body ?? "");
		expect(update.get("RecordType2")).toBe("A");
		expect(update.get("Address2")).toBe("1.1.1.1");
		expect(update.get("TTL2")).toBe("60");
		expect(update.get("HostName3")).toBeNull();
		expect(update.get("EmailType")).toBe("FWD");
		await client().deleteRecord(zone, {
			content: "1.2.3.4",
			id: "A:example.co.uk::1.2.3.4",
			name: "example.co.uk",
			priority: null,
			ttl: null,
			type: "A",
		});
		const remaining = new URLSearchParams(calls[5]?.body ?? "");
		expect(remaining.get("HostName1")).toBe("www");
		expect(remaining.get("HostName2")).toBeNull();
		const before = calls.length;
		await client().deleteRecord(zone, {
			content: "9.9.9.9",
			id: "A:example.co.uk::9.9.9.9",
			name: "example.co.uk",
			priority: null,
			ttl: null,
			type: "A",
		});
		expect(calls.length).toBe(before + 1);
	});

	test("an API error in a 200 answer names Namecheap's own message", async () => {
		stubFetch(() => ({
			raw: '<?xml version="1.0" encoding="utf-8"?><ApiResponse Status="ERROR" xmlns="http://api.namecheap.com/xml.response"><Errors><Error Number="1011150">Invalid request IP: 198.51.100.1</Error></Errors><Warnings /><RequestedCommand /></ApiResponse>',
			status: 200,
		}));
		await expect(client().listZones()).rejects.toThrow(
			"Namecheap: [1011150] Invalid request IP: 198.51.100.1",
		);
	});
});
