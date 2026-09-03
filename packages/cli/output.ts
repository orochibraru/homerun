import process from "node:process";

/** No dependency, matches this codebase's generally dependency-light posture (see the main app's hand-rolled cron matcher/SigV4 client for the same instinct). */
class CliOutput {
	printTable(rows: Record<string, unknown>[], columns: string[]): void {
		if (rows.length === 0) {
			console.log("(none)");
			return;
		}
		const widths = columns.map((col) =>
			Math.max(col.length, ...rows.map((r) => String(r[col] ?? "").length)),
		);
		const line = (cells: string[]) =>
			cells.map((c, i) => c.padEnd(widths[i])).join("  ");
		console.log(line(columns));
		console.log(line(widths.map((w) => "-".repeat(w))));
		for (const row of rows) {
			console.log(line(columns.map((col) => String(row[col] ?? ""))));
		}
	}

	printJson(value: unknown): void {
		console.log(JSON.stringify(value, null, 2));
	}

	fail(message: string): never {
		console.error(`error: ${message}`);
		process.exit(1);
	}
}

export const Output = new CliOutput();
