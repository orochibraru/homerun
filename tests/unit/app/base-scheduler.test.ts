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

const { BaseScheduler } = await import(
	"../../../src/lib/services/cron/base-scheduler"
);
const { AppLogDTO } = await import("../../../src/lib/dto/app-log-dto");

const registry = () =>
	(
		globalThis as unknown as {
			__scheduler_intervals?: Map<string, ReturnType<typeof setInterval>>;
		}
	).__scheduler_intervals;

let labels = 0;

class TestScheduler extends BaseScheduler {
	protected readonly label = `Test${++labels}`;
	protected override readonly intervalMs = 10;
	protected override readonly runOnStart: boolean;
	ticks = 0;
	release: (() => void) | null = null;

	constructor(
		private readonly work: (self: TestScheduler) => Promise<void>,
		runOnStart = false,
	) {
		super();
		this.runOnStart = runOnStart;
	}

	get key() {
		return this.label;
	}

	protected async tick(): Promise<void> {
		this.ticks += 1;
		await this.work(this);
	}
}

class DefaultScheduler extends BaseScheduler {
	protected readonly label = "DefaultTest";

	get key() {
		return this.label;
	}

	get tickEvery() {
		return this.intervalMs;
	}

	protected async tick(): Promise<void> {
		await Promise.resolve();
	}
}

let started: { key: string }[] = [];
let spies: { mockRestore: () => void }[] = [];

function track<T extends { key: string }>(scheduler: T): T {
	started.push(scheduler);
	return scheduler;
}

beforeEach(() => {
	spies = [
		spyOn(console, "log").mockImplementation(() => undefined),
		spyOn(console, "error").mockImplementation(() => undefined),
		spyOn(AppLogDTO, "create").mockResolvedValue(undefined as never),
	];
});

afterEach(() => {
	for (const scheduler of started) {
		clearInterval(registry()?.get(scheduler.key));
		registry()?.delete(scheduler.key);
	}
	started = [];
	for (const spy of spies.reverse()) {
		spy.mockRestore();
	}
});

describe("BaseScheduler", () => {
	test("ticks on its interval, not on start by default", async () => {
		const scheduler = track(new TestScheduler(async () => undefined));
		scheduler.start();
		expect(scheduler.ticks).toBe(0);
		expect(registry()?.has(scheduler.key)).toBe(true);
		await Bun.sleep(35);
		expect(scheduler.ticks).toBeGreaterThanOrEqual(2);
	});

	test("defaults to a one-minute tick", () => {
		const scheduler = track(new DefaultScheduler());
		scheduler.start();
		expect(scheduler.tickEvery).toBe(60_000);
		expect(registry()?.has("DefaultTest")).toBe(true);
	});

	test("runOnStart ticks immediately", () => {
		const scheduler = track(new TestScheduler(async () => undefined, true));
		scheduler.start();
		expect(scheduler.ticks).toBe(1);
	});

	test("starting twice keeps one interval", () => {
		const scheduler = track(new TestScheduler(async () => undefined, true));
		scheduler.start();
		const interval = registry()?.get(scheduler.key);
		scheduler.start();
		expect(registry()?.get(scheduler.key)).toBe(interval);
		expect(scheduler.ticks).toBe(1);
	});

	test("never overlaps a tick that's still running", async () => {
		const scheduler = track(
			new TestScheduler(
				(self) =>
					new Promise<void>((resolve) => {
						self.release = resolve;
					}),
				true,
			),
		);
		scheduler.start();
		await Bun.sleep(35);
		expect(scheduler.ticks).toBe(1);
		scheduler.release?.();
		await Bun.sleep(25);
		expect(scheduler.ticks).toBeGreaterThan(1);
	});

	test("a failing tick is logged and the interval keeps going", async () => {
		const scheduler = track(
			new TestScheduler(async () => {
				throw new Error("tick exploded");
			}, true),
		);
		scheduler.start();
		await Bun.sleep(35);
		expect(scheduler.ticks).toBeGreaterThan(1);
		const errors = (
			console.error as unknown as { mock: { calls: unknown[][] } }
		).mock.calls;
		expect(
			errors.some((call) => String(call.join(" ")).includes("tick failed")),
		).toBe(true);
	});
});
