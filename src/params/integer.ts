/** Matches a route segment made only of digits, such as a Sentry project id. */
export function match(param: string): boolean {
	return /^\d+$/.test(param);
}
