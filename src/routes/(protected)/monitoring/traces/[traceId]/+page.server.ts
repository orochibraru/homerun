import { error } from "@sveltejs/kit";
import { TraceSpanDTO } from "#lib/dto/trace-span-dto.js";
import { normalizeTraceId } from "#lib/tracing/list.js";

export const load = async ({ params }) => {
	const traceId = normalizeTraceId(params.traceId);
	if (!(traceId && (await TraceSpanDTO.inScope({ instance: true }, traceId)))) {
		error(404, "Trace not found");
	}
	return { spans: await TraceSpanDTO.spansOf(traceId), traceId };
};
