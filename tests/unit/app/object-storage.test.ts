import { describe, expect, test } from "bun:test";

const {
	bucketNameProblem,
	endpointProblem,
	LIFECYCLE_RULE_ID,
	lifecycleExpirationDays,
	lifecycleXml,
	objectCountLabel,
} = await import("../../../src/lib/object-storage");
const { parseObjectStoreForm } = await import(
	"../../../src/lib/server/validation/object-store"
);

describe("bucketNameProblem", () => {
	test("accepts S3-valid names", () => {
		for (const name of ["tfstate", "my.backups-2026", "abc"]) {
			expect(bucketNameProblem(name)).toBeNull();
		}
	});

	test("refuses names S3 refuses", () => {
		for (const name of [
			"ab",
			"Upper",
			"-leading",
			"trailing-",
			"two..dots",
			"under_score",
			"x".repeat(64),
		]) {
			expect(bucketNameProblem(name)).not.toBeNull();
		}
		expect(bucketNameProblem("192.168.1.10")).toContain("IP address");
	});
});

describe("endpointProblem", () => {
	test("wants a bare http(s) origin", () => {
		expect(endpointProblem("https://s3.eu-central-1.amazonaws.com")).toBeNull();
		expect(endpointProblem("http://minio:9000")).toBeNull();
		expect(endpointProblem("s3.example.com")).not.toBeNull();
		expect(endpointProblem("ftp://s3.example.com")).not.toBeNull();
		expect(endpointProblem("https://s3.example.com/bucket")).not.toBeNull();
		expect(endpointProblem("https://key:secret@s3.example.com")).not.toBeNull();
	});
});

describe("lifecycle", () => {
	test("the expiry written is the expiry read back", () => {
		const xml = lifecycleXml(30);
		expect(xml).toContain(`<ID>${LIFECYCLE_RULE_ID}</ID>`);
		expect(xml).toContain("<Status>Enabled</Status>");
		expect(lifecycleExpirationDays(xml)).toBe(30);
	});

	test("a disabled or non-expiring rule reads as no expiry", () => {
		expect(
			lifecycleExpirationDays(
				"<LifecycleConfiguration><Rule><Status>Disabled</Status><Expiration><Days>3</Days></Expiration></Rule></LifecycleConfiguration>",
			),
		).toBeNull();
		expect(
			lifecycleExpirationDays(
				"<LifecycleConfiguration><Rule><Status>Enabled</Status><AbortIncompleteMultipartUpload><DaysAfterInitiation>1</DaysAfterInitiation></AbortIncompleteMultipartUpload></Rule></LifecycleConfiguration>",
			),
		).toBeNull();
	});
});

describe("objectCountLabel", () => {
	test("pluralises and marks a capped count", () => {
		expect(objectCountLabel(1, false)).toBe("1 object");
		expect(objectCountLabel(1234, false)).toBe("1,234 objects");
		expect(objectCountLabel(10_000, true)).toBe("10,000+ objects");
	});
});

describe("parseObjectStoreForm", () => {
	function form(fields: Record<string, string>): FormData {
		const data = new FormData();
		for (const [key, value] of Object.entries(fields)) {
			data.set(key, value);
		}
		return data;
	}

	const valid = {
		accessKeyId: " AKIA ",
		endpoint: "https://s3.example.com/",
		name: " Hetzner ",
		region: "",
		secretAccessKey: "secret",
	};

	test("trims, defaults the region and drops a trailing slash", () => {
		expect(parseObjectStoreForm(form(valid), true)).toEqual({
			error: null,
			values: {
				accessKeyId: "AKIA",
				endpoint: "https://s3.example.com",
				name: "Hetzner",
				region: "us-east-1",
				secretAccessKey: "secret",
			},
		});
	});

	test("reports the first missing field", () => {
		expect(
			parseObjectStoreForm(form({ ...valid, name: "" }), true).error,
		).toContain("name");
		expect(
			parseObjectStoreForm(form({ ...valid, endpoint: "nope" }), true).error,
		).toContain("URL");
		expect(
			parseObjectStoreForm(form({ ...valid, accessKeyId: "" }), true).error,
		).toContain("access key id");
	});

	test("a blank secret only matters when it's required", () => {
		const blank = form({ ...valid, secretAccessKey: "" });
		expect(parseObjectStoreForm(blank, true).error).toContain("secret");
		expect(parseObjectStoreForm(blank, false).error).toBeNull();
	});
});
