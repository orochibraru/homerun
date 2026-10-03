import { config } from "#lib/config.js";
import { APP_VERSION } from "#lib/server/app-version.js";
import { nodeInstallScript } from "#lib/server/node-install-script.js";

export const GET = ({ url }) =>
	new Response(
		nodeInstallScript(config.auth.origin ?? url.origin, APP_VERSION),
		{
			headers: { "content-type": "text/x-shellscript; charset=utf-8" },
		},
	);
