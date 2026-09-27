export const URL_TOKEN = "{{url}}";

/** `envVars` with every `{{url}}` replaced by the service's public URL. */
export function fillUrlInEnv(
	envVars: Record<string, string>,
	url: string,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(envVars).map(([key, value]) => [
			key,
			value.replaceAll(URL_TOKEN, url),
		]),
	);
}
