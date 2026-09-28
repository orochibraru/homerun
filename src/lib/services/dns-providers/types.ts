export type DnsRecordType = "A" | "AAAA" | "CNAME" | "TXT" | "MX" | "CAA";

export const DNS_RECORD_TYPES: DnsRecordType[] = [
	"A",
	"AAAA",
	"CNAME",
	"TXT",
	"MX",
	"CAA",
];

export interface DnsZone {
	id: string;
	name: string;
}

export interface DnsRecord {
	content: string;
	id: string;
	name: string;
	priority: number | null;
	ttl: number | null;
	type: string;
}

export interface DnsRecordInput {
	content: string;
	name: string;
	priority?: number | null;
	ttl?: number | null;
	type: DnsRecordType;
}

export interface DnsProviderField {
	help?: string;
	key: string;
	label: string;
	optional?: boolean;
	placeholder?: string;
	secret: boolean;
}

export type DnsCredentials = Record<string, string>;

export interface DnsProviderClient {
	createRecord(zone: DnsZone, input: DnsRecordInput): Promise<DnsRecord>;
	deleteRecord(zone: DnsZone, record: DnsRecord): Promise<void>;
	listRecords(zone: DnsZone): Promise<DnsRecord[]>;
	listZones(): Promise<DnsZone[]>;
	updateRecord(
		zone: DnsZone,
		record: DnsRecord,
		input: DnsRecordInput,
	): Promise<DnsRecord>;
}

export interface DnsProviderDefinition {
	create(credentials: DnsCredentials): DnsProviderClient;
	docsUrl: string;
	fields: DnsProviderField[];
	id: string;
	name: string;
}
