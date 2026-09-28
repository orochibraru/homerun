/** One DNS/routing provider's verdict on syncing a hostname, so a caller can report it instead of a silent log line: `provider` is Pangolin, or the name of the DNS connection that manages the hostname's domain. */
export interface DnsSyncResult {
	detail: string;
	ok: boolean;
	provider: string;
}
