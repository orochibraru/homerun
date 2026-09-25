import { describe, expect, test } from "bun:test";
import {
	describeSchedule,
	scheduleFromCron,
	scheduleToCron,
} from "$lib/schedule";

describe("scheduleFromCron", () => {
	test("reads the four simple patterns back", () => {
		expect(scheduleFromCron("15 * * * *")).toMatchObject({
			minute: 15,
			mode: "hourly",
		});
		expect(scheduleFromCron("0 3 * * *")).toMatchObject({
			mode: "daily",
			time: "03:00",
		});
		expect(scheduleFromCron("30 22 * * 1")).toMatchObject({
			mode: "weekly",
			time: "22:30",
			weekday: 1,
		});
		expect(scheduleFromCron("5 4 15 * *")).toMatchObject({
			dayOfMonth: 15,
			mode: "monthly",
			time: "04:05",
		});
	});

	test("keeps anything else as custom, raw text intact", () => {
		for (const cron of ["*/5 * * * *", "0 3 * * 1-5", "0 3 1 1 *", "0 3 * *"]) {
			const schedule = scheduleFromCron(cron);
			expect(schedule.mode).toBe("custom");
			expect(schedule.custom).toBe(cron);
		}
	});

	test("defaults an empty schedule to every day at 03:00", () => {
		expect(scheduleFromCron(null)).toMatchObject({
			mode: "daily",
			time: "03:00",
		});
	});
});

describe("scheduleToCron and describeSchedule", () => {
	test("round-trip every simple pattern", () => {
		for (const cron of [
			"15 * * * *",
			"0 3 * * *",
			"30 22 * * 1",
			"5 4 15 * *",
		]) {
			expect(scheduleToCron(scheduleFromCron(cron))).toBe(cron);
		}
	});

	test("say what the schedule does in words", () => {
		expect(describeSchedule(scheduleFromCron("15 * * * *"))).toBe(
			"Every hour at :15",
		);
		expect(describeSchedule(scheduleFromCron("30 22 * * 1"))).toBe(
			"Every Monday at 22:30",
		);
		expect(describeSchedule(scheduleFromCron("5 4 15 * *"))).toBe(
			"On day 15 of every month at 04:05",
		);
		expect(describeSchedule(scheduleFromCron("*/5 * * * *"))).toBe(
			"Cron: */5 * * * *",
		);
		expect(
			describeSchedule({ ...scheduleFromCron(""), custom: "", mode: "custom" }),
		).toBe("No schedule");
	});
});
