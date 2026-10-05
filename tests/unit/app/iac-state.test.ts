import { describe, expect, test } from "bun:test";

const {
	basicAuthPassword,
	diffStates,
	instanceAddress,
	parseLockInfo,
	stateObjectKey,
	summarizeState,
	withSerial,
} = await import("../../../src/lib/iac-state");

function state(serial: number, resources: unknown[]): string {
	return JSON.stringify({
		lineage: "lin-1",
		resources,
		serial,
		version: 4,
	});
}

const web = (ami: string) => ({
	instances: [{ attributes: { ami, tags: { b: 1, a: 2 } }, index_key: 0 }],
	mode: "managed",
	name: "web",
	type: "aws_instance",
});

describe("instanceAddress", () => {
	test("prints addresses the way Terraform does", () => {
		expect(
			instanceAddress(
				{ mode: "managed", module: "module.db", name: "main", type: "aws_db" },
				{},
			),
		).toBe("module.db.aws_db.main");
		expect(
			instanceAddress({ mode: "data", name: "ami", type: "aws_ami" }, {}),
		).toBe("data.aws_ami.ami");
		expect(instanceAddress({ name: "x", type: "t" }, { index_key: "eu" })).toBe(
			't.x["eu"]',
		);
		expect(instanceAddress({ name: "x", type: "t" }, { index_key: 2 })).toBe(
			"t.x[2]",
		);
	});
});

describe("summarizeState", () => {
	test("reads the serial, lineage and every instance", () => {
		const summary = summarizeState(state(7, [web("ami-1")]));
		expect(summary.serial).toBe(7);
		expect(summary.lineage).toBe("lin-1");
		expect([...summary.resources.keys()]).toEqual(["aws_instance.web[0]"]);
	});

	test("refuses what isn't a state", () => {
		expect(() => summarizeState("[]")).toThrow("JSON object");
		expect(() => summarizeState('{"serial":"1"}')).toThrow("serial");
		expect(() => summarizeState("not json")).toThrow();
	});

	test("attribute key order doesn't count as a change", () => {
		const a = summarizeState(state(1, [web("ami-1")]));
		const b = summarizeState(
			state(2, [
				{
					...web("ami-1"),
					instances: [
						{
							attributes: { tags: { a: 2, b: 1 }, ami: "ami-1" },
							index_key: 0,
						},
					],
				},
			]),
		);
		expect(diffStates(a, b)).toEqual({ added: [], changed: [], removed: [] });
	});
});

describe("diffStates", () => {
	test("sorts instances into added, changed and removed", () => {
		const before = summarizeState(
			state(1, [
				web("ami-1"),
				{ instances: [{ attributes: {} }], name: "old", type: "aws_s3_bucket" },
			]),
		);
		const after = summarizeState(
			state(2, [
				web("ami-2"),
				{ instances: [{ attributes: {} }], name: "new", type: "aws_s3_bucket" },
			]),
		);
		expect(diffStates(before, after)).toEqual({
			added: ["aws_s3_bucket.new"],
			changed: ["aws_instance.web[0]"],
			removed: ["aws_s3_bucket.old"],
		});
	});

	test("the first version adds everything", () => {
		expect(
			diffStates(null, summarizeState(state(1, [web("a")]))).added,
		).toEqual(["aws_instance.web[0]"]);
	});
});

describe("withSerial", () => {
	test("replaces the serial and keeps the rest", () => {
		const body = withSerial(state(3, [web("a")]), 9);
		expect(JSON.parse(body)).toMatchObject({ lineage: "lin-1", serial: 9 });
		expect(() => withSerial("[]", 1)).toThrow();
	});
});

describe("basicAuthPassword", () => {
	test("reads the password half of Basic auth", () => {
		expect(basicAuthPassword(`Basic ${btoa("homerun:key-123")}`)).toBe(
			"key-123",
		);
		expect(basicAuthPassword(`basic ${btoa("u:a:b")}`)).toBe("a:b");
	});

	test("anything else is no password", () => {
		expect(basicAuthPassword(null)).toBeNull();
		expect(basicAuthPassword("Bearer abc")).toBeNull();
		expect(basicAuthPassword("Basic !!!")).toBeNull();
		expect(basicAuthPassword(`Basic ${btoa("nocolon")}`)).toBeNull();
		expect(basicAuthPassword(`Basic ${btoa("user:")}`)).toBeNull();
	});
});

describe("stateObjectKey", () => {
	test("nests versions under the project's folder", () => {
		expect(
			stateObjectKey({
				id: "v1",
				prefix: "/terraform/",
				serial: 4,
				slug: "lab",
			}),
		).toBe("terraform/lab/4-v1.tfstate");
		expect(
			stateObjectKey({ id: "v1", prefix: "", serial: 4, slug: "lab" }),
		).toBe("lab/4-v1.tfstate");
	});
});

describe("parseLockInfo", () => {
	test("only a JSON object is lock info", () => {
		expect(parseLockInfo({ ID: "x" })).toEqual({ ID: "x" });
		expect(parseLockInfo([1])).toBeNull();
		expect(parseLockInfo(null)).toBeNull();
		expect(parseLockInfo("x")).toBeNull();
	});
});
