import {
	isFailureEvent,
	NOTIFICATION_EVENTS,
} from "#lib/notification-events.js";
import type { ChannelMessage, MessageField } from "./notification-messages";

export const GROUP_WINDOW_MS = 60_000;
export const BURST_MAX_HOLD_MS = 5 * 60_000;
export const SCHEDULED_MAX_HOLD_MS = 60 * 60_000;

const MAX_GROUP_FIELDS = 20;
const DETAIL_TAIL_LINES = 10;

interface Lane {
	firstAt: number;
	lastAt: number;
	messages: ChannelMessage[];
}

export interface MessageGroup {
	messages: ChannelMessage[];
	scheduled: boolean;
}

/** An empty lane whose last message is long enough ago that the next one isn't grouped with it. */
function emptyLane(): Lane {
	return { firstAt: 0, lastAt: -Infinity, messages: [] };
}

/**
 * Decides when channel messages go out, from timestamps alone so it can be
 * driven by a test clock. A message with nothing sent in the last
 * `GROUP_WINDOW_MS` goes out at once; one arriving sooner is held, and the
 * held ones leave together after `GROUP_WINDOW_MS` without a new one (at most
 * `BURST_MAX_HOLD_MS` after the first). Scheduled-task outcomes are always
 * held, until the window has passed and no scheduled work is still queued or
 * running (at most `SCHEDULED_MAX_HOLD_MS`), so one scheduler run reports once.
 */
export class NotificationGrouper {
	#burst: Lane = emptyLane();
	#scheduled: Lane = emptyLane();

	/** Whether any message is waiting to be flushed. */
	get pending(): boolean {
		return (
			this.#burst.messages.length > 0 || this.#scheduled.messages.length > 0
		);
	}

	/** Whether a scheduled-task outcome is waiting, the only case `due` needs to know about running scheduled work for. */
	get holdsScheduled(): boolean {
		return this.#scheduled.messages.length > 0;
	}

	/** Takes a message in and returns it back when it should be sent right away, or null when it's now held. */
	add(
		message: ChannelMessage,
		scheduled: boolean,
		now: number,
	): ChannelMessage | null {
		const lane = scheduled ? this.#scheduled : this.#burst;
		const quiet = now - lane.lastAt >= GROUP_WINDOW_MS;
		lane.lastAt = now;
		if (!scheduled && quiet && lane.messages.length === 0) {
			return message;
		}
		if (lane.messages.length === 0) {
			lane.firstAt = now;
		}
		lane.messages.push(message);
		return null;
	}

	/** The held groups due at `now`, removed from the grouper; `scheduledActive` is whether scheduled work is still queued or running. */
	due(now: number, scheduledActive: boolean): MessageGroup[] {
		const groups: MessageGroup[] = [];
		const burst = this.#burst;
		if (
			burst.messages.length > 0 &&
			(now - burst.lastAt >= GROUP_WINDOW_MS ||
				now - burst.firstAt >= BURST_MAX_HOLD_MS)
		) {
			groups.push({ messages: burst.messages, scheduled: false });
			burst.messages = [];
		}
		const scheduled = this.#scheduled;
		if (
			scheduled.messages.length > 0 &&
			((now - scheduled.lastAt >= GROUP_WINDOW_MS && !scheduledActive) ||
				now - scheduled.firstAt >= SCHEDULED_MAX_HOLD_MS)
		) {
			groups.push({ messages: scheduled.messages, scheduled: true });
			scheduled.messages = [];
		}
		return groups;
	}

	/** Drops every held message. */
	clear(): void {
		this.#burst = emptyLane();
		this.#scheduled = emptyLane();
	}
}

/** The label the settings matrix shows for an event. */
function eventLabel(message: ChannelMessage): string {
	return (
		NOTIFICATION_EVENTS.find((info) => info.event === message.event)?.label ??
		message.event
	);
}

/** The last `DETAIL_TAIL_LINES` lines of a message's detail. */
function detailTail(detail: string): string {
	return detail.split("\n").slice(-DETAIL_TAIL_LINES).join("\n");
}

/**
 * Folds several messages for one channel into one: the title counts what
 * succeeded and failed, each message becomes a field (event label → its
 * title, the first `MAX_GROUP_FIELDS` of them), and the detail is every
 * failure's title and detail tail. It takes the event of its first failure,
 * or of its first message when nothing failed, which is what colours it and
 * what a queued retry checks the channel is still subscribed to.
 */
export function groupedMessage(
	messages: ChannelMessage[],
	scheduled: boolean,
): ChannelMessage {
	const failed = messages.filter((message) => isFailureEvent(message.event));
	const succeeded = messages.length - failed.length;
	const counts = [
		succeeded > 0 ? `${succeeded} ok` : null,
		failed.length > 0 ? `${failed.length} failed` : null,
	]
		.filter(Boolean)
		.join(", ");
	const fields: MessageField[] = messages
		.slice(0, MAX_GROUP_FIELDS)
		.map((message) => ({ name: eventLabel(message), value: message.title }));
	if (messages.length > MAX_GROUP_FIELDS) {
		fields.push({
			name: "More",
			value: `${messages.length - MAX_GROUP_FIELDS} more not listed`,
		});
	}
	const details = failed
		.map((message) =>
			message.detail
				? `${message.title}\n${detailTail(message.detail)}`
				: message.title,
		)
		.join("\n\n");
	const first = failed[0] ?? messages[0];
	return {
		detail: details || null,
		event: first.event,
		fields,
		link: first.link,
		serviceId: null,
		serviceName: null,
		timestamp: messages.at(-1)?.timestamp ?? first.timestamp,
		title: `${scheduled ? "Scheduled tasks" : `${messages.length} notifications`}: ${counts}`,
	};
}
