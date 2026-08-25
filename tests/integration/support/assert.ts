/** Asserts a fetch/openapi-fetch response actually succeeded and its `data` is present, returning it non-null : avoids `!` non-null assertions (this repo's lint config forbids them) scattered through every test. */
export function expectOk<T>(data: T | undefined, response: Response): T {
	if (!response.ok || data === undefined) {
		throw new Error(
			`Expected a successful response, got ${response.status} : ${JSON.stringify(data)}`,
		);
	}
	return data;
}
