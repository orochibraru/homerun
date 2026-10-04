import { isSmtpEnabled } from "#lib/config.js";

export const load = () => ({ smtpEnabled: isSmtpEnabled() });
