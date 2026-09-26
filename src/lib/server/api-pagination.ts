import { json } from "@sveltejs/kit";
import { type ListQuery, parseListQuery } from "./list-query";

const API_DEFAULT_PER_PAGE = 100;

/**
 * Parses a REST API list request's paging, search and filter params, defaulting
 * to 100 items a page instead of the dashboard's per-account default.
 */
export function parseApiListQuery(url: URL): ListQuery {
	return parseListQuery(url, { perPage: API_DEFAULT_PER_PAGE });
}

/**
 * Responds with one page of items as a bare JSON array, carrying the paging
 * metadata in `x-page`, `x-per-page` and `x-total-count` headers.
 */
export function jsonPage<T>(
	items: T[],
	meta: { page: number; perPage: number; total: number },
): Response {
	return json(items, {
		headers: {
			"x-page": String(meta.page),
			"x-per-page": String(meta.perPage),
			"x-total-count": String(meta.total),
		},
	});
}
