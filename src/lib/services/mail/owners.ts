import { isServiceAccount } from "#lib/user-types.js";

import { UserService } from "../user.service.ts";

export interface MailOwnerChoice {
	email: string;
	id: string;
	name: string;
}

/** Who a mailbox can belong to: the owner changes its password from their own account settings. */
class MailOwnerServiceClass {
	/** Every account a mailbox can belong to: people, not service accounts. */
	async choices(): Promise<MailOwnerChoice[]> {
		return (await UserService.listUsers())
			.filter((user) => !isServiceAccount(user))
			.map((user) => ({ email: user.email, id: user.id, name: user.name }));
	}

	/**
	 * Throws unless `ownerId` is null or an account a mailbox can belong to.
	 *
	 * @throws When no such person exists.
	 */
	async check(ownerId: string | null): Promise<void> {
		if (!ownerId) {
			return;
		}
		const owner = await UserService.getUser(ownerId);
		if (!owner || isServiceAccount(owner)) {
			throw new Error("Pick one of Homerun's accounts as the owner.");
		}
	}
}

export const MailOwnerService = new MailOwnerServiceClass();
