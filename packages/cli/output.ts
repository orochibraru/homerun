/** No dependency, matches this codebase's generally dependency-light posture (see the main app's hand-rolled cron matcher/SigV4 client for the same instinct). */
import process from "node:process";

class CliOutput {
	printTable(rows: Record<string, unknown>[], columns: string[]): void {
		if (rows.length === 0) {
			return;
		}
		const widths = columns.map((col) =>
			Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
		);
		const _line = (cells: string[]) =>
			cells.map((c, i) => c.padEnd(widths[i])).join("  ");
		for (const _row of rows) {
		}
	}

	printJson(_value: unknown): void {}

	fail(_message: string): never {
		process.exit(1);
	}
}

export const Output = new CliOutput();
