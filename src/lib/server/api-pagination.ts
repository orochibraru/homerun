import { json } from "@sveltejs/kit";
import { type ListQuery, parseListQuery } from "./list-query";

const API_DEFAULT_PER_PAGE = 100;

export function parseApiListQuery(url: URL): ListQuery {
	return parseListQuery(url, { perPage: API_DEFAULT_PER_PAGE });
}

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
