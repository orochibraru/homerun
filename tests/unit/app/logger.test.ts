import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";

mock.module("$app/environment", () => ({
	browser: false,
	building: false,
	dev: false,
}));

const { config } = await import("../../../src/lib/config");
const { DEPLOY_LOG_SCOPE, Logger, jsonFields } = await import(
	"../../../src/lib/logger"
);
const { AppLogDTO } = await import("../../../src/lib/dto/app-log-dto");
const { NotificationDTO } = await import(
	"../../../src/lib/dto/notification-dto"
);

const SERVICE_ID = "0b8f5c1e-4d2a-4c3b-9e7f-1a2b3c4d5e6f";
const original = { format: config.logFormat, level: config.logLevel };

let created: Record<string, unknown>[] = [];
let notified: [string, string][] = [];
let spies: { mockRestore: () => void }[] = [];

function quietConsole() {
	return {
		error: spyOn(console, "error").mockImplementation(() => undefined),
		info: spyOn(console, "info").mockImplementation(() => undefined),
		log: spyOn(console, "log").mockImplementation(() => undefined),
	};
}

function makeLogger(
	format: "console" | "json",
	level: string,
	prefix = "Test",
) {
	config.logFormat = format;
	config.logLevel = level as typeof config.logLevel;
	return new Logger(prefix);
}

const settle = () => Bun.sleep(5);

beforeEach(() => {
	created = [];
	notified = [];
	spies = [
		spyOn(AppLogDTO, "create").mockImplementation(async (input) => {
			created.push(input as unknown as Record<string, unknown>);
			return undefined as never;
		}),
		spyOn(NotificationDTO, "notifyServiceError").mockImplementation(
			async (serviceId: string, message: string) => {
				notified.push([serviceId, message]);
			},
		),
	];
});

afterEach(() => {
	for (const spy of spies.reverse()) {
		spy.mockRestore();
	}
	config.logFormat = original.format;
	config.logLevel = original.level;
});

describe("Logger construction", () => {
	test("rejects an unknown level in console format", () => {
		expect(() => makeLogger("console", "loud")).toThrow(
			"Invalid log level: loud",
		);
	});

	test("takes format and level from config", () => {
		const logger = makeLogger("json", "warn", "Scope");
		expect(logger.logFormat).toBe("json");
		expect(logger.logLevel).toBe("warn");
		expect(logger.prefix).toBe("Scope");
	});
});

describe("Logger console format", () => {
	test("each level prints its tag, prefix and params", () => {
		const out = quietConsole();
		const logger = makeLogger("console", "trace");
		logger.info("hello", 1);
		logger.warn("careful");
		logger.error("broken");
		logger.debug("dbg");
		const logged = out.log.mock.calls.map((call) => call.join(" "));
		expect(
			logged.some((line) => line.includes("INFO") && line.includes("hello 1")),
		).toBe(true);
		expect(
			logged.some((line) => line.includes("WARN") && line.includes("careful")),
		).toBe(true);
		expect(
			logged.some((line) => line.includes("DEBUG") && line.includes("dbg")),
		).toBe(true);
		expect(out.error.mock.calls[0].join(" ")).toContain("broken");
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});

	test("debug is filtered below its level", () => {
		const out = quietConsole();
		const logger = makeLogger("console", "info");
		logger.debug("hidden");
		expect(out.log).not.toHaveBeenCalled();
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});

	test("a logger with a level outside the known set logs nothing", () => {
		const out = quietConsole();
		const logger = makeLogger("json", "info");
		logger.logLevel = "silent" as never;
		logger.info("x");
		logger.warn("x");
		logger.error("x");
		expect(out.log).not.toHaveBeenCalled();
		expect(out.error).not.toHaveBeenCalled();
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});
});

describe("jsonFields", () => {
	test("merges plain objects and keeps everything else under params", () => {
		const err = new Error("boom");
		expect(jsonFields([])).toEqual({});
		expect(jsonFields([{ a: 1 }, { b: 2 }])).toEqual({ a: 1, b: 2 });
		expect(jsonFields(["x", { a: 1 }, err, [1]])).toEqual({
			a: 1,
			params: ["x", err, [1]],
		});
	});
});

describe("Logger json format", () => {
	test("each level logs a structured object with its scope", () => {
		const out = quietConsole();
		const logger = makeLogger("json", "info", "Api");
		logger.logLevel = "trace";
		logger.info("i", "extra");
		logger.warn("w");
		logger.debug("d");
		logger.error("e");
		expect(out.log.mock.calls.map(([entry]) => entry)).toEqual([
			{ input: "i", level: "info", params: ["extra"], scope: "Api" },
			{ input: "w", level: "warn", scope: "Api" },
			{ input: "d", level: "debug", scope: "Api" },
		]);
		expect(out.error.mock.calls[0][0]).toEqual({
			level: "error",
			message: "e",
			scope: "Api",
		});
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});
});

describe("Logger.log", () => {
	test("colours every level in console format and spreads metadata", () => {
		const out = quietConsole();
		const logger = makeLogger("console", "error");
		for (const level of ["debug", "info", "warn", "error", "trace", "odd"]) {
			logger.log({
				level: level as never,
				message: `m-${level}`,
				metadata: [1],
			});
		}
		const lines = out.log.mock.calls.map((call) => call.join(" "));
		expect(lines).toHaveLength(6);
		expect(lines[5]).toContain("[LEVEL::odd]");
		expect(lines.every((line) => line.endsWith(" 1"))).toBe(true);
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});

	test("logs a structured object in json format, persisting warn and error only", async () => {
		const out = quietConsole();
		const logger = makeLogger("json", "info", "Jobs");
		logger.log({ level: "info", message: "fine" });
		logger.log({ level: "warn", message: "meh", metadata: [{ a: 1 }] });
		logger.log({ level: "error", message: "bad" });
		expect(out.log.mock.calls[1][0]).toEqual({
			a: 1,
			level: "warn",
			message: "meh",
			scope: "Jobs",
		});
		await settle();
		expect(created.map((row) => [row.level, row.message])).toEqual([
			["warn", "meh"],
			["error", "bad"],
		]);
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});
});

describe("Logger.http", () => {
	const req = new Request("https://homerun.test/api?x=1", { method: "POST" });
	const url = new URL(req.url);

	test("console format prints the pre line and a coloured post line", () => {
		const out = quietConsole();
		const logger = makeLogger("console", "info");
		logger.http({ duration: 0, req, res: new Response(), type: "pre", url });
		logger.http({
			duration: 12,
			req,
			res: new Response(null, { status: 200 }),
			type: "post",
			url,
		});
		logger.http({
			duration: 3,
			req,
			res: new Response(null, { status: 404 }),
			type: "post",
			url,
		});
		const lines = out.info.mock.calls.map((call) => call.join(" "));
		expect(lines[0]).toContain("[HTTPS::POST]");
		expect(lines[0]).toContain("/api?x=1");
		expect(lines[1]).toContain("200");
		expect(lines[1]).toContain("[12ms]");
		expect(lines[2]).toContain("404");
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});

	test("json format reports pending duration and omits empty fields", () => {
		const out = quietConsole();
		const logger = makeLogger("json", "info", "Http");
		logger.http({
			duration: 0,
			req,
			res: new Response(null, { status: 204 }),
			type: "pre",
			url: new URL("https://homerun.test/p"),
		});
		logger.http({
			duration: 8,
			req,
			res: new Response(null, { status: 500, statusText: "Oops" }),
			type: "post",
			url,
		});
		expect(out.info.mock.calls[0][0]).toEqual({
			duration: "pending",
			method: "POST",
			path: "/p",
			proto: "https:",
			scope: "Http",
			search: undefined,
			status: 204,
			statusText: undefined,
		});
		expect(out.info.mock.calls[1][0]).toMatchObject({
			duration: 8,
			search: "?x=1",
			status: 500,
			statusText: "Oops",
		});
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});
});

describe("Logger persistence", () => {
	test("stores warn/error lines with serialised metadata and the service id", async () => {
		const out = quietConsole();
		const logger = makeLogger("json", "info", "Docker");
		const circular: Record<string, unknown> = {};
		circular.self = circular;
		logger.warn(`pull failed service=${SERVICE_ID}`, { tag: "v1" }, circular);
		logger.error(new Error("boom"), "detail");
		logger.error({ code: 7 });
		await settle();
		expect(created[0]).toMatchObject({
			level: "warn",
			message: `pull failed service=${SERVICE_ID}`,
			scope: "Docker",
			serviceId: SERVICE_ID,
		});
		expect(created[0].metadata).toBe(
			JSON.stringify(['{"tag":"v1"}', "[object Object]"]),
		);
		expect(String(created[1].message)).toContain("Error: boom");
		expect(created[1].serviceId).toBeNull();
		expect(created[2]).toMatchObject({ message: '{"code":7}', metadata: null });
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});

	test("an error naming a service raises a notification, outside the Deploy scope", async () => {
		const out = quietConsole();
		makeLogger("json", "info", "Runtime").error(
			"crashed",
			`service=${SERVICE_ID}`,
		);
		makeLogger("json", "info", DEPLOY_LOG_SCOPE).error(
			`failed service=${SERVICE_ID}`,
		);
		makeLogger("json", "info", "Runtime").warn(`slow service=${SERVICE_ID}`);
		await settle();
		expect(notified).toEqual([[SERVICE_ID, "crashed"]]);
		expect(created[0].serviceId).toBe(SERVICE_ID);
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});

	test("a failing write or notification never throws", async () => {
		const out = quietConsole();
		spies.push(
			spyOn(AppLogDTO, "create").mockRejectedValue(new Error("db down")),
			spyOn(NotificationDTO, "notifyServiceError").mockRejectedValue(
				new Error("db down"),
			),
		);
		const logger = makeLogger("json", "info", "Runtime");
		expect(() => logger.error(`x service=${SERVICE_ID}`)).not.toThrow();
		await settle();
		for (const spy of Object.values(out)) {
			spy.mockRestore();
		}
	});
});
