const PAGE_SIZE = 1000;
const MAX_PAGES = 20;

/** An Integration API failure, keeping the status so a caller can tell a 404 or a 409 apart. */
export class PangolinApiError extends Error {
	readonly status: number;

	/** Wraps one failed call's HTTP status and rendered message. */
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

/** Pangolin's own response envelope : `{data, success, message?, error?}`, `data` holds the endpoint-specific payload. */
export interface PangolinEnvelope<T> {
	data: T | null;
	message?: string;
	success: boolean;
}

interface PangolinPagination {
	limit?: number;
	offset?: number;
	total?: number | string;
}

export interface PangolinListQuery {
	baseUrl: string;
	field: string;
	pageParam: "offset" | "page";
	path: string;
	sizeParam: "limit" | "pageSize";
	token: string;
}

/**
 * Issues one authenticated call against the Pangolin Integration API and
 * parses the JSON response body.
 *
 * @throws When the body isn't valid JSON (including an HTML dashboard
 *   response mistaken for the API), or when the response status isn't ok.
 */
export async function pangolinRequest<T>(
	baseUrl: string,
	token: string,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
		...init,
		headers: {
			Authorization: `Bearer ${token}`,
			"Content-Type": "application/json",
			...Object.fromEntries(new Headers(init?.headers)),
		},
	});
	const raw = await response.text();
	let body: unknown = null;
	if (raw) {
		try {
			body = JSON.parse(raw);
		} catch {
			throw new Error(
				`Pangolin API ${response.status} returned ${raw.trimStart().startsWith("<") ? "HTML, not JSON : this looks like the dashboard, not the Integration API" : "an unreadable body"}`,
			);
		}
	}
	if (!response.ok) {
		const message = (body as PangolinEnvelope<unknown> | null)?.message;
		throw new PangolinApiError(
			response.status,
			`Pangolin API ${response.status}: ${message ?? raw}`,
		);
	}
	return body as T;
}

/**
 * Collects every page of a paginated list endpoint, keyed by the array's
 * own field name (`sites`, `resources`, `domains`). `/sites` and
 * `/resources` default to 20 per page, so reading page one only is how a site
 * or an existing resource used to go missing on a real org: this asks for
 * 1000 per page and follows `pagination.total` (coerced, since Pangolin's
 * Postgres `count(*)` arrives as a string), capped at 20 pages. Recursive rather than
 * a loop : this repo's `noAwaitInLoops` lint rule forbids the obvious
 * `for` version, and the requests are inherently sequential (each page
 * depends on the previous one's count).
 */
export async function pangolinListAll<T>(
	query: PangolinListQuery,
	collected: T[] = [],
	page = 0,
): Promise<T[]> {
	const params = new URLSearchParams({
		[query.pageParam]:
			query.pageParam === "offset"
				? String(collected.length)
				: String(page + 1),
		[query.sizeParam]: String(PAGE_SIZE),
	});
	const response = await pangolinRequest<
		PangolinEnvelope<
			Record<string, unknown> & { pagination?: PangolinPagination }
		>
	>(query.baseUrl, query.token, `${query.path}?${params}`);
	const batch = response.data?.[query.field];
	if (!Array.isArray(batch)) {
		throw new Error(
			`Pangolin returned no "${query.field}" list for ${query.path} : is that base URL the Integration API (it ends in /v1) rather than the dashboard?`,
		);
	}
	const items = [...collected, ...(batch as T[])];
	const rawTotal = response.data?.pagination?.total;
	const total = rawTotal === undefined ? Number.NaN : Number(rawTotal);
	const done =
		batch.length === 0 ||
		Number.isNaN(total) ||
		items.length >= total ||
		page + 1 >= MAX_PAGES;
	return done ? items : pangolinListAll<T>(query, items, page + 1);
}
