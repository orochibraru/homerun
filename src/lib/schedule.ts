export type ScheduleMode = "hourly" | "daily" | "weekly" | "monthly" | "custom";

export interface Schedule {
	custom: string;
	dayOfMonth: number;
	minute: number;
	mode: ScheduleMode;
	time: string;
	weekday: number;
}

export const WEEKDAYS = [
	"Sunday",
	"Monday",
	"Tuesday",
	"Wednesday",
	"Thursday",
	"Friday",
	"Saturday",
];

const NUMBER = /^\d+$/;

function field(value: string, min: number, max: number): number | null {
	if (!NUMBER.test(value)) {
		return null;
	}
	const n = Number(value);
	return n >= min && n <= max ? n : null;
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

/**
 * Reads a 5-field cron expression back into the picker's shape: hourly,
 * daily, weekly or monthly when it's one of those simple patterns, custom
 * (keeping the raw text) otherwise. Empty defaults to every day at 03:00.
 */
export function scheduleFromCron(cron: string | null | undefined): Schedule {
	const base: Schedule = {
		custom: cron?.trim() ?? "",
		dayOfMonth: 1,
		minute: 0,
		mode: "daily",
		time: "03:00",
		weekday: 1,
	};
	const text = cron?.trim() ?? "";
	if (text === "") {
		return base;
	}
	const [m = "", h = "", dom = "", month = "", dow = ""] = text.split(/\s+/);
	const minute = field(m, 0, 59);
	if (text.split(/\s+/).length !== 5 || minute === null || month !== "*") {
		return { ...base, mode: "custom" };
	}
	if (h === "*" && dom === "*" && dow === "*") {
		return { ...base, minute, mode: "hourly" };
	}
	const hour = field(h, 0, 23);
	if (hour === null) {
		return { ...base, mode: "custom" };
	}
	const time = `${pad(hour)}:${pad(minute)}`;
	if (dom === "*" && dow === "*") {
		return { ...base, mode: "daily", time };
	}
	const weekday = field(dow, 0, 6);
	if (dom === "*" && weekday !== null) {
		return { ...base, mode: "weekly", time, weekday };
	}
	const dayOfMonth = field(dom, 1, 31);
	if (dow === "*" && dayOfMonth !== null) {
		return { ...base, dayOfMonth, mode: "monthly", time };
	}
	return { ...base, mode: "custom" };
}

/** The 5-field cron expression a picker state stands for; custom returns its raw text trimmed. */
export function scheduleToCron(schedule: Schedule): string {
	if (schedule.mode === "custom") {
		return schedule.custom.trim();
	}
	if (schedule.mode === "hourly") {
		return `${schedule.minute} * * * *`;
	}
	const [hour = 0, minute = 0] = schedule.time.split(":").map(Number);
	switch (schedule.mode) {
		case "daily":
			return `${minute} ${hour} * * *`;
		case "weekly":
			return `${minute} ${hour} * * ${schedule.weekday}`;
		default:
			return `${minute} ${hour} ${schedule.dayOfMonth} * *`;
	}
}

/** One plain-English line for a picker state, e.g. "Every Monday at 03:00". */
export function describeSchedule(schedule: Schedule): string {
	switch (schedule.mode) {
		case "hourly":
			return `Every hour at :${pad(schedule.minute)}`;
		case "daily":
			return `Every day at ${schedule.time}`;
		case "weekly":
			return `Every ${WEEKDAYS[schedule.weekday]} at ${schedule.time}`;
		case "monthly":
			return `On day ${schedule.dayOfMonth} of every month at ${schedule.time}`;
		default:
			return schedule.custom.trim()
				? `Cron: ${schedule.custom.trim()}`
				: "No schedule";
	}
}
