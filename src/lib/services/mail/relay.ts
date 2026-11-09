import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { type MailRelay, mailRelayProblem } from "#lib/mail.js";

import { decryptSecret, encryptSecret } from "../secrets.ts";

export interface MailRelaySettings {
	hasPassword: boolean;
	host: string | null;
	port: number | null;
	user: string | null;
}

export interface MailRelayInput {
	host: string;
	password: string | null;
	port: number | null;
	user: string;
}

export const DEFAULT_RELAY_PORT = 587;

/**
 * The mail server's outbound relay (smarthost): every outgoing message is
 * handed to it rather than delivered on port 25, for hosts whose port 25 is
 * blocked or whose address has no matching reverse DNS. Stored with the other
 * mail settings, the password encrypted.
 */
class MailRelayServiceClass {
	/** The relay with its password decrypted, null when the server delivers directly. */
	async relay(): Promise<MailRelay | null> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		if (!row.mailRelayHost) {
			return null;
		}
		return {
			host: row.mailRelayHost,
			password: row.mailRelayPasswordEnc
				? decryptSecret(row.mailRelayPasswordEnc)
				: null,
			port: row.mailRelayPort ?? DEFAULT_RELAY_PORT,
			user: row.mailRelayUser,
		};
	}

	/** The relay as the Server tab and the API show it: the password only as whether one is saved. */
	async settings(): Promise<MailRelaySettings> {
		const row = (await InstanceSettingsDTO.get()).toJSON();
		return {
			hasPassword: Boolean(row.mailRelayPasswordEnc),
			host: row.mailRelayHost,
			port: row.mailRelayPort,
			user: row.mailRelayUser,
		};
	}

	/**
	 * Saves the relay; an empty host turns it off and forgets the
	 * credentials. An empty password keeps the saved one for the same user.
	 * The container picks it up from the `syncMail` job the caller queues.
	 *
	 * @throws When the host, port or credentials are refused.
	 */
	async save(input: MailRelayInput): Promise<void> {
		const settings = await InstanceSettingsDTO.get();
		const host = input.host.trim().toLowerCase();
		if (!host) {
			await settings.persistCoreServices({
				mailRelayHost: null,
				mailRelayPasswordEnc: null,
				mailRelayPort: null,
				mailRelayUser: null,
			});
			return;
		}
		const user = input.user.trim() || null;
		const saved = await this.relay();
		const kept = saved?.user && saved.user === user ? saved.password : null;
		const relay: MailRelay = {
			host,
			password: user ? input.password || kept : null,
			port: input.port ?? DEFAULT_RELAY_PORT,
			user,
		};
		const problem = mailRelayProblem(relay);
		if (problem) {
			throw new Error(problem);
		}
		await settings.persistCoreServices({
			mailRelayHost: relay.host,
			mailRelayPasswordEnc: relay.password
				? encryptSecret(relay.password)
				: null,
			mailRelayPort: relay.port,
			mailRelayUser: relay.user,
		});
	}
}

export const MailRelayService = new MailRelayServiceClass();
