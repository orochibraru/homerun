import { afterEach, describe, expect, test } from "bun:test";
import {
	route53,
	route53Client,
} from "../../../../src/lib/services/dns-providers/route53";
import { signV4 } from "../../../../src/lib/services/dns-providers/sigv4";
import { stubFetch } from "./stub-fetch";

const SIGNED =
	"5334e559e5aca8083b45f17bc9bc32e2810e44996f561488ca2f022900901588";

const zone = { id: "Z123", name: "example.com" };
const credentials = {
	accessKeyId: "AKIDEXAMPLE",
	secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
};
const now = () => new Date("2015-08-30T12:36:00Z");
const API = "https://route53.amazonaws.com/2013-04-01";

const set = (name: string, type: string, ttl: number, values: string[]) =>
	`<ResourceRecordSet><Name>${name}</Name><Type>${type}</Type><TTL>${ttl}</TTL><ResourceRecords>${values.map((value) => `<ResourceRecord><Value>${value}</Value></ResourceRecord>`).join("")}</ResourceRecords></ResourceRecordSet>`;
const sets = (body: string, next = "") =>
	`<?xml version="1.0"?><ListResourceRecordSetsResponse><ResourceRecordSets>${body}</ResourceRecordSets>${next ? `<IsTruncated>true</IsTruncated>${next}` : "<IsTruncated>false</IsTruncated>"}<MaxItems>300</MaxItems></ListResourceRecordSetsResponse>`;
const xml = (raw: string) => ({ raw, status: 200 });

afterEach(() => stubFetch.restore());

describe("SigV4", () => {
	test("matches AWS's own get-vanilla and get-vanilla-query-order-key-case vectors", () => {
		const signing = {
			...credentials,
			region: "us-east-1",
			service: "service",
		};
		expect(
			signV4(
				signing,
				{ body: "", method: "GET", url: "https://example.amazonaws.com/" },
				now(),
			).authorization,
		).toBe(
			"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31",
		);
		expect(
			signV4(
				signing,
				{
					body: "",
					method: "GET",
					url: "https://example.amazonaws.com/?Param2=value2&Param1=value1",
				},
				now(),
			).authorization,
		).toContain(
			"Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500",
		);
	});
});

describe("Route 53", () => {
	test("lists every page of hosted zones, signed for route53 in us-east-1", async () => {
		const calls = stubFetch((request) =>
			new URL(request.url).searchParams.get("marker")
				? xml(
						"<ListHostedZonesResponse><HostedZones><HostedZone><Id>/hostedzone/Z2</Id><Name>other.org.</Name><CallerReference>b</CallerReference></HostedZone></HostedZones><IsTruncated>false</IsTruncated></ListHostedZonesResponse>",
					)
				: xml(
						"<ListHostedZonesResponse><HostedZones><HostedZone><Id>/hostedzone/Z1</Id><Name>Example.com.</Name><CallerReference>a</CallerReference></HostedZone></HostedZones><IsTruncated>true</IsTruncated><NextMarker>Z2</NextMarker></ListHostedZonesResponse>",
					),
		);
		const client = route53Client({ ...credentials, sessionToken: "tok" }, now);
		expect(await client.listZones()).toEqual([
			{ id: "Z1", name: "example.com" },
			{ id: "Z2", name: "other.org" },
		]);
		expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
			`GET ${API}/hostedzone?maxitems=100`,
			`GET ${API}/hostedzone?maxitems=100&marker=Z2`,
		]);
		expect(calls[0]?.headers.get("x-amz-date")).toBe("20150830T123600Z");
		expect(calls[0]?.headers.get("x-amz-security-token")).toBe("tok");
		expect(calls[0]?.headers.get("authorization")).toBe(
			`AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/route53/aws4_request, SignedHeaders=host;x-amz-date;x-amz-security-token, Signature=${SIGNED}`,
		);
	});

	test("lists every rrset page, one record per value, skipping alias sets", async () => {
		const calls = stubFetch((request) =>
			new URL(request.url).searchParams.get("name")
				? xml(
						sets(
							`${set("example.com.", "MX", 3600, ["10 mx1.example.net.", "20 mx2.example.net."])}${set("\\052.example.com.", "CNAME", 60, ["example.com."])}<ResourceRecordSet><Name>www.example.com.</Name><Type>A</Type><AliasTarget><DNSName>lb.aws.</DNSName></AliasTarget></ResourceRecordSet>`,
						),
					)
				: xml(
						sets(
							set("example.com.", "TXT", 300, [
								'"v=spf1 " "-all"',
								"&quot;hello&quot;",
							]),
							"<NextRecordName>example.com.</NextRecordName><NextRecordType>MX</NextRecordType>",
						),
					),
		);
		const records = await route53Client(credentials, now).listRecords(zone);
		expect(calls.map((call) => call.url)).toEqual([
			`${API}/hostedzone/Z123/rrset?maxitems=300`,
			`${API}/hostedzone/Z123/rrset?maxitems=300&name=example.com.&type=MX`,
		]);
		expect(records).toEqual([
			{
				content: "v=spf1 -all",
				id: 'TXT:example.com:"v=spf1 " "-all"',
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: "hello",
				id: 'TXT:example.com:"hello"',
				name: "example.com",
				priority: null,
				ttl: 300,
				type: "TXT",
			},
			{
				content: "mx1.example.net",
				id: "MX:example.com:10 mx1.example.net.",
				name: "example.com",
				priority: 10,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "mx2.example.net",
				id: "MX:example.com:20 mx2.example.net.",
				name: "example.com",
				priority: 20,
				ttl: 3600,
				type: "MX",
			},
			{
				content: "example.com",
				id: "CNAME:*.example.com:example.com.",
				name: "*.example.com",
				priority: null,
				ttl: 60,
				type: "CNAME",
			},
		]);
	});

	test("create appends to the rrset, update rewrites it in place, delete keeps the other values or drops the set", async () => {
		let current = set("app.example.com.", "A", 120, ["1.1.1.1"]);
		const calls = stubFetch((request) =>
			request.method === "GET"
				? xml(sets(current))
				: xml("<ChangeResourceRecordSetsResponse/>"),
		);
		const client = route53Client(credentials, now);
		const created = await client.createRecord(zone, {
			content: "2.2.2.2",
			name: "App.example.com",
			type: "A",
		});
		expect(created).toEqual({
			content: "2.2.2.2",
			id: "A:app.example.com:2.2.2.2",
			name: "app.example.com",
			priority: null,
			ttl: 120,
			type: "A",
		});
		expect(calls[0]?.url).toBe(
			`${API}/hostedzone/Z123/rrset?maxitems=1&name=app.example.com.&type=A`,
		);
		expect(calls[1]?.method).toBe("POST");
		expect(calls[1]?.url).toBe(`${API}/hostedzone/Z123/rrset/`);
		expect(calls[1]?.headers.get("content-type")).toBe("application/xml");
		expect(calls[1]?.body).toBe(
			'<?xml version="1.0" encoding="UTF-8"?><ChangeResourceRecordSetsRequest xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><ChangeBatch><Comment>Managed by Homerun</Comment><Changes><Change><Action>UPSERT</Action><ResourceRecordSet><Name>app.example.com.</Name><Type>A</Type><TTL>120</TTL><ResourceRecords><ResourceRecord><Value>1.1.1.1</Value></ResourceRecord><ResourceRecord><Value>2.2.2.2</Value></ResourceRecord></ResourceRecords></ResourceRecordSet></Change></Changes></ChangeBatch></ChangeResourceRecordSetsRequest>',
		);
		current = set("app.example.com.", "A", 120, ["1.1.1.1", "2.2.2.2"]);
		await client.updateRecord(zone, created, {
			content: "3.3.3.3",
			name: "app.example.com",
			ttl: 60,
			type: "A",
		});
		expect(calls[3]?.body).toContain(
			"<Action>UPSERT</Action><ResourceRecordSet><Name>app.example.com.</Name><Type>A</Type><TTL>60</TTL><ResourceRecords><ResourceRecord><Value>1.1.1.1</Value></ResourceRecord><ResourceRecord><Value>3.3.3.3</Value></ResourceRecord></ResourceRecords>",
		);
		await client.deleteRecord(zone, created);
		expect(calls[5]?.body).toContain(
			"<Action>UPSERT</Action><ResourceRecordSet><Name>app.example.com.</Name><Type>A</Type><TTL>120</TTL><ResourceRecords><ResourceRecord><Value>1.1.1.1</Value></ResourceRecord></ResourceRecords>",
		);
		current = set("app.example.com.", "A", 120, ["2.2.2.2"]);
		await client.deleteRecord(zone, created);
		expect(calls[7]?.body).toContain(
			"<Action>DELETE</Action><ResourceRecordSet><Name>app.example.com.</Name><Type>A</Type><TTL>120</TTL><ResourceRecords><ResourceRecord><Value>2.2.2.2</Value></ResourceRecord></ResourceRecords>",
		);
		current = "";
		const before = calls.length;
		await client.deleteRecord(zone, created);
		expect(calls.length).toBe(before + 1);
	});

	test("a new rrset is CREATEd with quoted TXT, and a rename moves the value in one batch", async () => {
		let current = "";
		const calls = stubFetch((request) =>
			request.method === "GET" ? xml(sets(current)) : xml("<ok/>"),
		);
		const client = route53Client(credentials, now);
		const txt = await client.createRecord(zone, {
			content: 'say "hi"',
			name: "example.com",
			ttl: 600,
			type: "TXT",
		});
		expect(txt.content).toBe('say "hi"');
		expect(calls[1]?.body).toContain(
			'<Action>CREATE</Action><ResourceRecordSet><Name>example.com.</Name><Type>TXT</Type><TTL>600</TTL><ResourceRecords><ResourceRecord><Value>"say \\"hi\\""</Value></ResourceRecord></ResourceRecords>',
		);
		current = set("mail.example.com.", "MX", 300, ["10 mx.example.net."]);
		await client.updateRecord(
			zone,
			{
				content: "mx.example.net",
				id: "MX:mail.example.com:10 mx.example.net.",
				name: "mail.example.com",
				priority: 10,
				ttl: 300,
				type: "MX",
			},
			{
				content: "mx.example.net",
				name: "example.com",
				priority: 5,
				type: "MX",
			},
		);
		const body = calls.at(-1)?.body ?? "";
		expect(body).toContain(
			"<Action>DELETE</Action><ResourceRecordSet><Name>mail.example.com.</Name><Type>MX</Type><TTL>300</TTL><ResourceRecords><ResourceRecord><Value>10 mx.example.net.</Value></ResourceRecord>",
		);
		expect(body).toContain(
			"<Action>CREATE</Action><ResourceRecordSet><Name>example.com.</Name><Type>MX</Type><TTL>300</TTL><ResourceRecords><ResourceRecord><Value>5 mx.example.net</Value></ResourceRecord>",
		);
	});

	test("a failed call names Route 53's own message", async () => {
		stubFetch(() => ({
			raw: '<?xml version="1.0"?><ErrorResponse xmlns="https://route53.amazonaws.com/doc/2013-04-01/"><Error><Type>Sender</Type><Code>InvalidClientTokenId</Code><Message>The security token included in the request is invalid.</Message></Error><RequestId>r</RequestId></ErrorResponse>',
			status: 403,
		}));
		await expect(route53.create(credentials).listZones()).rejects.toThrow(
			"Route 53 403: The security token included in the request is invalid.",
		);
		stubFetch(() => ({
			raw: "<InvalidChangeBatch><Messages><Message>Tried to create resource record set but it already exists</Message></Messages></InvalidChangeBatch>",
			status: 400,
		}));
		await expect(route53.create(credentials).listRecords(zone)).rejects.toThrow(
			"Route 53 400: Tried to create resource record set but it already exists",
		);
	});
});
