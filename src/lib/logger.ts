import {
	blue,
	cyan,
	gray,
	green,
	magenta,
	red,
	white,
	yellow,
} from "@kitql/helpers";
import { building, dev } from "$app/environment";
import { config } from "$lib/config";

// Matches this codebase's own `service=<uuid>` convention in log messages
// (deploy.service.ts, docker/containers.ts, etc.) so a persisted warn/error
// log can be heuristically attributed to a service without threading an
// explicit serviceId through every one of the ~40 existing Logger call
// sites — see schema.ts's `appLog` docstring.
const SERVICE_ID_RE = /service=([0-9a-fA-F-]{36})/;

function extractServiceId(text: string): string | null {
	return SERVICE_ID_RE.exec(text)?.[1] ?? null;
}

function stringifyForPersist(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	if (value instanceof Error) {
		return value.stack ?? value.message;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

/**
 * Best-effort persistence of a warn/error-level log line to the `app_log`
 * table, for the per-service Errors tab (and a future instance-wide log
 * view) — see schema.ts's `appLog` docstring. Dynamically imports the DTO
 * (rather than a static top-level import) since $lib/logger.ts itself
 * isn't under `$lib/server/`, so this keeps the server-only db code out of
 * the module graph unless a warn/error call actually fires. Never throws,
 * never awaited by the caller — a logging call must never fail the
 * operation it's logging.
 */
function persistLog(
	level: "warn" | "error",
	scope: string | undefined,
	input: unknown,
	optionalParams: unknown[],
): void {
	if (building) {
		return;
	}
	const message = stringifyForPersist(input);
	const metadata =
		optionalParams.length > 0
			? stringifyForPersist(optionalParams.map(stringifyForPersist))
			: null;
	const serviceId =
		extractServiceId(message) ?? (metadata ? extractServiceId(metadata) : null);

	import("$lib/dto/app-log-dto")
		.then(({ AppLogDTO }) =>
			AppLogDTO.create({
				level,
				message,
				metadata,
				scope: scope ?? null,
				serviceId,
			}),
		)
		.catch(() => {
			// Logging must never throw — if the DB isn't up yet (e.g. very
			// early boot) or the write fails, just drop it.
		});
}

export type LogFormats = "console" | "json";

export const logLevels = {
	DEBUG: "debug",
	ERROR: "error",
	INFO: "info",
	TRACE: "trace",
	WARN: "warn",
} as const;

export type LogLevel = (typeof logLevels)[keyof typeof logLevels];

export interface HttpLog {
	duration: number;
	req: Request;
	res: Response;
	type: "pre" | "post";
	url: URL;
}

export class Logger {
	logFormat: "console" | "json";
	prefix?: string;
	prettyPrefix?: string;
	logLevel: LogLevel;

	/**
	 * Initializes a new instance of the Logger class.
	 * @param prefix Optional string to be used as a prefix for log messages.
	 * Sets the log format based on the LOG_FORMAT environment variable. If the environment variable
	 * is not set, defaults to 'console'. Throws an error if the format is invalid.
	 */
	constructor(prefix?: string) {
		this.prefix = prefix;
		this.prettyPrefix = magenta(`[${this.prefix}]`);
		this.logFormat = config.logFormat;
		if (dev && !building) {
			this.logLevel = logLevels.DEBUG;
		} else if (
			config.logFormat === "console" &&
			!Object.values(logLevels).includes(config.logLevel as LogLevel)
		) {
			throw new Error(
				`Invalid log level: ${config.logLevel}. Valid levels are: ${Object.values(
					logLevels,
				).join(", ")}`,
			);
		} else {
			this.logLevel = config.logLevel;
		}
	}

	log({
		level,
		message,
		metadata = [],
	}: {
		level: LogLevel;
		message: string;
		metadata?: unknown[];
	}) {
		if (this.logFormat === "console") {
			const colorFn = (str: string) => {
				switch (level) {
					case logLevels.DEBUG:
						return cyan(str);
					case logLevels.INFO:
						return blue(str);
					case logLevels.WARN:
						return yellow(str);
					case logLevels.ERROR:
						return red(str);
					case logLevels.TRACE:
						return white(str);
					default:
						return str;
				}
			};

			console.log(
				colorFn(`[LEVEL::${level}]`),
				this.prettyPrefix,
				message,
				...metadata,
			);
			return;
		}

		console.log({
			level,
			message,
			scope: this.prefix,
			...metadata,
		});
	}

	/**
	 * Logs an HTTP request and response information.
	 * @param {HttpLog} log - An object containing details of the HTTP request/response.
	 * @param {Request} log.req - The HTTP request object.
	 * @param {Response} log.res - The HTTP response object.
	 * @param {number} log.duration - The duration of the request in milliseconds.
	 * @param {string} log.path - The path of the request.
	 * @param {'pre' | 'post'} log.type - The type of log, either 'pre' for request or 'post' for response.
	 * If `this.logFormat` is set to 'console', logs formatted information to the console.
	 * Otherwise, logs a JSON object with relevant HTTP details.
	 */
	http({ req, res, duration, url, type }: HttpLog) {
		if (this.logFormat === "console") {
			if (type === "pre") {
				return console.info(
					blue(
						`[${url.protocol.replace(":", "").toUpperCase()}::${req.method}]`,
					),
					`${url.pathname}${url.search}`,
					this.prettyPrefix,
				);
			}

			let color: (str: string) => string;

			color = green;
			if (res.status > 307) {
				// Error
				color = red;
			}

			return console.info(
				color(
					`[${url.protocol.replace(":", "").toUpperCase()}::${req.method}]`,
				),
				color(res.status.toString()),
				`${url.pathname}${url.search} ${gray(`[${duration}ms]`)}`,
				this.prettyPrefix,
			);
		}

		return console.info({
			duration: duration === 0 ? "pending" : duration,
			method: req.method,
			path: url.pathname,
			proto: url.protocol,
			scope: this.prefix,
			search: url.search === "" ? undefined : url.search,
			status: res.status,
			statusText: res.statusText === "" ? undefined : res.statusText,
		});
	}

	/**
	 * Logs an INFO level message to the console.
	 * @param input The input to log. Can be any type. If an object, it will be stringified.
	 * @param optionalParams Any additional parameters to log.
	 * If `this.logFormat` is set to 'console', the message will be logged as a console.log.
	 * Otherwise, it will be logged as a JSON object with the level set to 'info'.
	 */
	info(input: unknown, ...optionalParams: unknown[]) {
		const acceptedLogLevels = [
			logLevels.INFO,
			logLevels.WARN,
			logLevels.ERROR,
			logLevels.DEBUG,
			logLevels.TRACE,
		];
		if (!acceptedLogLevels.includes(this.logLevel as LogLevel)) {
			return;
		}

		if (this.logFormat === "console") {
			return console.log(
				blue(`[LEVEL::${logLevels.INFO.toUpperCase()}] `),
				this.prettyPrefix,
				input,
				...optionalParams,
			);
		}

		return console.log({
			input,
			level: logLevels.INFO,
			scope: this.prefix,
			...optionalParams,
		});
	}

	/**
	 * Logs a WARN level message to the console.
	 * @param input The input to log. Can be any type. If an object, it will be stringified.
	 * @param optionalParams Any additional parameters to log.
	 * If `this.logFormat` is set to 'console', the message will be logged as a console.log with a yellow prefix.
	 * Otherwise, it will be logged as a JSON object with the level set to 'warn'.
	 */
	warn(input: unknown, ...optionalParams: unknown[]) {
		const acceptedLogLevels = [
			logLevels.WARN,
			logLevels.INFO,
			logLevels.ERROR,
			logLevels.DEBUG,
			logLevels.TRACE,
		];
		if (!acceptedLogLevels.includes(this.logLevel as LogLevel)) {
			return;
		}

		persistLog("warn", this.prefix, input, optionalParams);

		if (this.logFormat === "console") {
			return console.log(
				yellow(`[LEVEL::${logLevels.WARN.toUpperCase()}] `),
				this.prettyPrefix,
				input,
				...optionalParams,
			);
		}

		return console.log({
			input,
			level: logLevels.WARN,
			scope: this.prefix,
			...optionalParams,
		});
	}

	/**
	 * Logs an ERROR level message to the console.
	 * @param err The error to log.
	 * @param optionalParams Any additional parameters to log.
	 * If `this.logFormat` is set to 'console', logs an error to the console with a red prefix.
	 * Otherwise, logs a JSON object with the level set to 'error' and the error as the message.
	 */
	// biome-ignore lint/suspicious/noExplicitAny: This is a logger
	error(err: any, ...optionalParams: unknown[]) {
		const acceptedLogLevels = [
			logLevels.ERROR,
			logLevels.INFO,
			logLevels.WARN,
			logLevels.DEBUG,
			logLevels.TRACE,
		];
		if (!acceptedLogLevels.includes(this.logLevel as LogLevel)) {
			return;
		}

		persistLog("error", this.prefix, err, optionalParams);

		if (this.logFormat === "console") {
			return console.error(
				red(`[LEVEL::${logLevels.ERROR.toUpperCase()}]`),
				this.prettyPrefix,
				err,
				...optionalParams,
			);
		}

		return console.error({
			level: logLevels.ERROR,
			message: err,
			scope: this.prefix,
			...optionalParams,
		});
	}

	/**
	 * Logs a DEBUG level message to the console.
	 * @param input The input to log. Can be any type. If an object, it will be stringified.
	 * @param optionalParams Any additional parameters to log.
	 * If `this.logFormat` is set to 'console', the message will be logged as a console.log with a cyan prefix.
	 * Otherwise, it will be logged as a JSON object with the level set to 'debug'.
	 */
	debug(input: unknown, ...optionalParams: unknown[]) {
		const acceptedLogLevels = [logLevels.DEBUG, logLevels.TRACE];
		// @ts-expect-error Completely normal we're catching this behaviour
		if (!acceptedLogLevels.includes(this.logLevel)) {
			return;
		}

		if (this.logFormat === "console") {
			return console.log(
				cyan(`[LEVEL::${logLevels.DEBUG.toUpperCase()}]`),
				this.prettyPrefix,
				input,
				...optionalParams,
			);
		}

		return console.log({
			input,
			level: logLevels.DEBUG,
			scope: this.prefix,
			...optionalParams,
		});
	}

	/**
	 * Logs a TRACE level message to the console.
	 * @param input The input to log. Can be any type. If an object, it will be stringified.
	 * @param optionalParams Any additional parameters to log.
	 * If `this.logFormat` is set to 'console', the message will be logged as a console.log with a cyan prefix.
	 * Otherwise, it will be logged as a JSON object with the level set to 'trace'.
	 */

	trace(input: unknown, ...optionalParams: unknown[]) {
		const acceptedLogLevels = [logLevels.TRACE];
		// @ts-expect-error Completely normal we're catching this behaviour
		if (!acceptedLogLevels.includes(this.logLevel)) {
			return;
		}

		if (this.logFormat === "console") {
			console.log();
			return console.log(
				this.prettyPrefix,
				white(`[LEVEL::${logLevels.TRACE.toUpperCase()}]`),
				input,
				...optionalParams,
			);
		}

		return console.log({
			input,
			level: logLevels.TRACE,
			scope: this.prefix,
			...optionalParams,
		});
	}
}
