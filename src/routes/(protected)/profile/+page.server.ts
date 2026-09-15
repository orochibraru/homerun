import { isSmtpEnabled } from "$lib/config";

export const load = () => ({ smtpEnabled: isSmtpEnabled() });
