import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface StoredConfig {
	apiKey: string;
	baseUrl: string;
}

/**
 * Real instance state (the resolved config dir/file paths, fixed at
 * construction the same way the old module-scope constants were fixed at
 * module load), wrapped in a class instead of loose functions over
 * module-scope constants.
 */
class CliConfigStore {
	readonly #dir = join(homedir(), ".config", "homerun");
	readonly #file = join(this.#dir, "config.json");

	configPath(): string {
		return this.#file;
	}

	readStoredConfig(): StoredConfig | null {
		if (!existsSync(this.#file)) {
			return null;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.#file, "utf8"));
			if (
				typeof parsed?.baseUrl === "string" &&
				typeof parsed?.apiKey === "string"
			) {
				return { apiKey: parsed.apiKey, baseUrl: parsed.baseUrl };
			}
			return null;
		} catch {
			return null;
		}
	}

	/** Contains a live API key, kept out of group/other read via 0600/0700, same posture as any other locally-stored credential. */
	writeStoredConfig(config: StoredConfig): void {
		mkdirSync(this.#dir, { mode: 0o700, recursive: true });
		writeFileSync(this.#file, JSON.stringify(config, null, 2), {
			mode: 0o600,
		});
		chmodSync(this.#file, 0o600);
	}

	clearStoredConfig(): void {
		if (existsSync(this.#file)) {
			rmSync(this.#file);
		}
	}
}

export const ConfigStore = new CliConfigStore();
