import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import {
	InvalidLogPatternError,
	type LogOwner,
	ServiceLogDTO,
} from "#lib/dto/service-log-dto.js";
import { Logger } from "#lib/logger.js";
import {
	isLogRange,
	type LogHistoryLine,
	type LogHistoryPage,
	type LogHistoryQuery,
	type LogHistoryView,
	type LogRange,
	logRetentionDays,
	MAX_LOG_PAGE,
	MAX_LOG_RETENTION_DAYS,
	MIN_LOG_RETENTION_DAYS,
	parseLogHistoryQuery,
} from "#lib/logs/history.js";

const logger = new Logger("LogHistory");

const PRUNE_BATCH = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;

const MAX_DOWNLOAD_LINES = 50_000;

/** A history search as a page renders it: the parsed query, its page of lines, and what was wrong with the input, if anything. */
export interface LogHistoryResult {
	error: string | null;
	page: LogHistoryPage;
	query: LogHistoryQuery;
}

/** Search, retention and pruning of the container logs the homerun worker ships into `service_log`. */
class LogHistoryServiceClass {
	/** How many days of service logs this instance keeps. */
	async retentionDays(): Promise<number> {
		return logRetentionDays((await InstanceSettingsDTO.get()).toJSON());
	}

	/**
	 * Saves how many days of service logs to keep.
	 *
	 * @throws When `days` isn't a whole number within range.
	 */
	async saveRetention(days: number): Promise<void> {
		if (
			!Number.isInteger(days) ||
			days < MIN_LOG_RETENTION_DAYS ||
			days > MAX_LOG_RETENTION_DAYS
		) {
			throw new Error(
				`Keep logs between ${MIN_LOG_RETENTION_DAYS} and ${MAX_LOG_RETENTION_DAYS} days.`,
			);
		}
		const settings = await InstanceSettingsDTO.get();
		await settings.persistLogRetention({ logRetentionDays: days });
		logger.info(`Log retention saved: ${days}d`);
	}

	/**
	 * Searches `owner`'s stored lines with the query URL parameters carry
	 * (see `parseLogHistoryQuery`), reporting a malformed parameter or regex
	 * as `error` with an empty page rather than throwing.
	 */
	async search(
		owner: LogOwner,
		params: URLSearchParams,
		defaultRange: LogRange,
	): Promise<LogHistoryResult> {
		let query: LogHistoryQuery;
		try {
			query = parseLogHistoryQuery(params, new Date(), defaultRange);
		} catch (error) {
			return {
				error: error instanceof Error ? error.message : String(error),
				page: { lines: [], nextCursor: null },
				query: parseLogHistoryQuery(
					new URLSearchParams(),
					new Date(),
					defaultRange,
				),
			};
		}
		try {
			return {
				error: null,
				page: await ServiceLogDTO.search(owner, query),
				query,
			};
		} catch (error) {
			if (error instanceof InvalidLogPatternError) {
				return {
					error: error.message,
					page: { lines: [], nextCursor: null },
					query,
				};
			}
			throw error;
		}
	}

	/**
	 * What a log history page renders for `owner` from its URL: the search
	 * over the last 24 hours by default (see `search`), the form's values to
	 * fill back in, the instances with stored lines, the oldest line kept and
	 * the retention.
	 */
	async view(owner: LogOwner, url: URL): Promise<LogHistoryView> {
		const range = url.searchParams.get("range");
		const [result, instances, oldest, retentionDays] = await Promise.all([
			this.search(owner, url.searchParams, "24h"),
			ServiceLogDTO.instances(owner),
			ServiceLogDTO.oldest(owner),
			this.retentionDays(),
		]);
		return {
			error: result.error,
			filters: {
				deploymentId: result.query.deploymentId ?? "",
				from: url.searchParams.get("from") ?? "",
				instance: result.query.instance ?? "",
				paged: result.query.before !== null,
				q: result.query.q,
				range: isLogRange(range) ? range : "24h",
				regex: result.query.regex,
				stream: result.query.stream ?? "",
				to: url.searchParams.get("to") ?? "",
			},
			instances,
			oldest,
			page: result.page,
			retentionDays,
		};
	}

	/**
	 * Every one of `owner`'s stored lines matching the query URL parameters
	 * carry, newest first, up to 50,000, for a download.
	 *
	 * @throws When a parameter or the regex is malformed.
	 */
	async collect(
		owner: LogOwner,
		params: URLSearchParams,
		defaultRange: LogRange,
	): Promise<LogHistoryLine[]> {
		const search = new URLSearchParams(params);
		search.delete("before");
		search.set("limit", String(MAX_LOG_PAGE));
		const query = parseLogHistoryQuery(search, new Date(), defaultRange);
		const lines: LogHistoryLine[] = [];
		for (;;) {
			// oxlint-disable-next-line no-await-in-loop -- each page starts where the previous one stopped
			const page = await ServiceLogDTO.search(owner, query);
			lines.push(...page.lines);
			const last = page.lines.at(-1);
			if (!(page.nextCursor && last) || lines.length >= MAX_DOWNLOAD_LINES) {
				return lines.slice(0, MAX_DOWNLOAD_LINES);
			}
			query.before = { id: last.id, time: last.time };
		}
	}

	/** Deletes stored lines older than the retention, in batches. */
	async prune(now = new Date()): Promise<void> {
		const days = await this.retentionDays();
		const deleted = await ServiceLogDTO.pruneBefore(
			new Date(now.getTime() - days * DAY_MS),
			PRUNE_BATCH,
		);
		if (deleted > 0) {
			logger.info(`Pruned ${deleted} log lines older than ${days} days.`);
		}
	}
}

export const LogHistoryService = new LogHistoryServiceClass();
