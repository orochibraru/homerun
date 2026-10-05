import { TraceSpanDTO } from "#lib/dto/trace-span-dto.js";
import { parseListQuery } from "#lib/server/list-query.js";
import { TRACE_FILTER_KEYS, TRACE_SORT_KEYS } from "#lib/tracing/list.js";

export const load = async ({ parent, url }) => {
	const { preferences } = await parent();
	const query = parseListQuery(
		url,
		{ filterKeys: TRACE_FILTER_KEYS, sortKeys: TRACE_SORT_KEYS },
		preferences.perPage,
	);
	return {
		listing: TraceSpanDTO.listTraces({ instance: true }, query),
		searched: query.active,
	};
};
