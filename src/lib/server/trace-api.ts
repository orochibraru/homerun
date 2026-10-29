import { type TraceScope, TraceSpanDTO } from "#lib/dto/trace-span-dto.js";
import { jsonPage } from "#lib/server/api-pagination.js";
import { parseListQuery } from "#lib/server/list-query.js";
import {
	normalizeTraceId,
	TRACE_FILTER_KEYS,
	TRACE_SORT_KEYS,
} from "#lib/tracing/list.js";

/** Responds with one page of the traces in `scope`, filtered, searched and sorted by the request's query. */
export async function tracePage(
	scope: TraceScope,
	url: URL,
): Promise<Response> {
	const query = parseListQuery(url, {
		filterKeys: TRACE_FILTER_KEYS,
		perPage: 50,
		sortKeys: TRACE_SORT_KEYS,
	});
	const page = await TraceSpanDTO.listTraces(scope, query);
	return jsonPage(page.items, page);
}

/** Responds with every span of `rawTraceId` when one of them is in `scope`, else a 404. */
export async function traceSpans(
	scope: TraceScope,
	rawTraceId: string,
): Promise<Response> {
	const traceId = normalizeTraceId(rawTraceId);
	if (!(traceId && (await TraceSpanDTO.inScope(scope, traceId)))) {
		return Response.json({ error: "Trace not found" }, { status: 404 });
	}
	const spans = await TraceSpanDTO.spansOf(traceId);
	return Response.json({
		spans: spans.map(({ id: _id, ...span }) => span),
		traceId,
	});
}
