/** One DNS/routing provider's verdict on syncing a hostname, so a caller can report it instead of a silent log line. */
export interface DnsSyncResult {
	detail: string;
	ok: boolean;
	provider: "cloudflare" | "pangolin";
}
