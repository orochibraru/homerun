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

const CONFIG_DIR = join(homedir(), ".config", "homerun");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");

export function configPath(): string {
	return CONFIG_FILE;
}

export function readStoredConfig(): StoredConfig | null {
	if (!existsSync(CONFIG_FILE)) {
		return null;
	}
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
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
export function writeStoredConfig(config: StoredConfig): void {
	mkdirSync(CONFIG_DIR, { mode: 0o700, recursive: true });
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
	chmodSync(CONFIG_FILE, 0o600);
}

export function clearStoredConfig(): void {
	if (existsSync(CONFIG_FILE)) {
		rmSync(CONFIG_FILE);
	}
}
