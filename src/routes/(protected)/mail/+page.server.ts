import { MailDomainDTO } from "#lib/dto/mail-domain-dto.js";
import { MailMailboxDTO } from "#lib/dto/mail-mailbox-dto.js";

export const load = async () => {
	const [domains, mailboxes] = await Promise.all([
		MailDomainDTO.list(),
		MailMailboxDTO.list(),
	]);
	return {
		domains: domains.map((domain) => ({
			...domain.summary(),
			mailboxes: mailboxes.filter((box) => box.toJSON().domainId === domain.id)
				.length,
		})),
	};
};
