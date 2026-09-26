import { appendFileSync } from "node:fs";
import process from "node:process";
import { stripVTControlCharacters } from "node:util";
import type { Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const ICONS: Record<string, string> = {
	failed: "FAIL",
	interrupted: "STOP",
	passed: "ok",
	skipped: "skip",
	timedOut: "TIMEOUT",
};

/**
 * Prints one line per template once the run ends (its final attempt's
 * outcome, duration, and the result, skip reason or first error line), and
 * appends the same table to `$GITHUB_STEP_SUMMARY` when CI provides one.
 */
export default class TemplateReport implements Reporter {
	#rows = new Map<
		string,
		{ detail: string; seconds: number; status: string }
	>();

	/** Records a template's latest attempt, so a retried one reports its final outcome. */
	onTestEnd(test: TestCase, result: TestResult): void {
		if (test.parent.project()?.name !== "templates") {
			return;
		}
		const annotation = (type: string) =>
			result.annotations.findLast((entry) => entry.type === type)?.description;
		const error = stripVTControlCharacters(
			result.error?.message?.split("\n")[0] ?? "",
		);
		this.#rows.set(test.title, {
			detail:
				(result.status === "passed" ? annotation("result") : undefined) ??
				(result.status === "skipped" ? annotation("skip") : undefined) ??
				error,
			seconds: Math.round(result.duration / 1000),
			status:
				result.retry > 0 && result.status === "passed"
					? "flaky"
					: result.status,
		});
	}

	/** Prints the table and writes it to the job summary. */
	onEnd(): void {
		const rows = [...this.#rows].sort(([a], [b]) => a.localeCompare(b));
		const count = (status: string) =>
			rows.filter(([, row]) => row.status === status).length;
		const header = `Templates: ${count("passed")} passed, ${count("flaky")} flaky, ${count("failed") + count("timedOut")} failed, ${count("skipped")} skipped`;
		console.log(`\n${header}`);
		for (const [title, row] of rows) {
			console.log(
				`  ${(ICONS[row.status] ?? row.status).padEnd(7)} ${title.padEnd(64)} ${String(row.seconds).padStart(4)}s  ${row.detail}`,
			);
		}
		const summary = process.env.GITHUB_STEP_SUMMARY;
		if (summary) {
			appendFileSync(
				summary,
				[
					`### ${header}`,
					"",
					"| Template | Result | Time | Detail |",
					"| --- | --- | --- | --- |",
					...rows.map(
						([title, row]) =>
							`| ${title} | ${ICONS[row.status] ?? row.status} | ${row.seconds}s | ${row.detail.replaceAll("|", "\\|")} |`,
					),
					"",
				].join("\n"),
			);
		}
	}
}
