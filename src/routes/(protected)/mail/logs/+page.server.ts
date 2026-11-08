import {
	deliveryFailures,
	parseMailLog,
	summarizeMailLog,
} from "#lib/mail-log.js";
import { DockerService } from "#lib/services/docker.service.js";

const TAIL_CHOICES = [500, 1500, 5000];
const DEFAULT_TAIL = 1500;
const VIEWS = ["all", "problems", "deliveries"] as const;

export const load = async ({ url }) => {
	const requested = Number(url.searchParams.get("tail"));
	const tail = TAIL_CHOICES.includes(requested) ? requested : DEFAULT_TAIL;
	const rawView = url.searchParams.get("view");
	const view = VIEWS.find((candidate) => candidate === rawView) ?? "all";
	const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
	const lines = parseMailLog(
		await DockerService.mailLogs(tail).catch(() => ""),
	);
	const shown = lines.filter(
		(line) =>
			(view === "all" ||
				(view === "problems" && line.level !== "info") ||
				(view === "deliveries" && line.delivery)) &&
			(!q || line.raw.toLowerCase().includes(q)),
	);
	return {
		failures: deliveryFailures(lines).slice(-50).reverse(),
		lines: shown,
		q,
		summary: summarizeMailLog(lines),
		tail,
		tailChoices: TAIL_CHOICES,
		total: lines.length,
		view,
	};
};
