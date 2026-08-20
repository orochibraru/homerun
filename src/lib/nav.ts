// Dashboard-only app : no public marketing pages to link to here.
// Signed-in navigation lives in the navbar's user menu and the
// (protected) sidebar instead. Kept as an array (not deleted) so a
// future top-level link has an obvious home.
export const navLinks: { href: string; label: string; requiresAuth?: true }[] =
	[];
