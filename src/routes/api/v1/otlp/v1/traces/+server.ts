import { TracingService } from "#lib/services/tracing.service.js";

export const POST = async ({ request }) => await TracingService.ingest(request);
