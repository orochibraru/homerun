import { config } from "$lib/config";
import { APP_VERSION } from "$lib/server/app-version";
import { nodeInstallScript } from "$lib/server/node-install-script";

export const GET = ({ url }) =>
	new Response(
		nodeInstallScript(config.auth.origin ?? url.origin, APP_VERSION),
		{
			headers: { "content-type": "text/x-shellscript; charset=utf-8" },
		},
	);
