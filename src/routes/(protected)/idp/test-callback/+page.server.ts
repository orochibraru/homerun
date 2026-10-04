import { config } from "#lib/config.js";
import {
	OAUTH_TEST_COOKIE,
	OauthTestService,
} from "#lib/services/oauth-test.service.js";

export const load = async ({ cookies, parent, url }) => {
	await parent();
	const test = OauthTestService.readState(cookies.get(OAUTH_TEST_COOKIE));
	cookies.delete(OAUTH_TEST_COOKIE, { path: "/idp" });
	return {
		result: await OauthTestService.finish(
			test,
			url.searchParams,
			config.auth.origin ?? url.origin,
		),
	};
};
