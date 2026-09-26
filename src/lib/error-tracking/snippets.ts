export interface SdkSnippet {
	code: string;
	id: string;
	install: string;
	label: string;
}

/**
 * Setup snippets for the official Sentry SDKs. With `injected`, the server
 * SDKs read `SENTRY_DSN`, `SENTRY_RELEASE` and `SENTRY_ENVIRONMENT` from the
 * env Homerun sets, so the snippet passes nothing; the browser SDK always
 * needs the public DSN spelled out, since it runs on the visitor's machine.
 */
export function sdkSnippets(
	publicDsn: string,
	serverDsn: string,
	injected: boolean,
): SdkSnippet[] {
	const nodeOptions = injected ? "{}" : `{\n  dsn: "${serverDsn}",\n}`;
	const pythonOptions = injected ? "" : `dsn="${serverDsn}"`;
	const goOptions = injected ? "" : `Dsn: "${serverDsn}"`;
	return [
		{
			code: `// instrument.js, imported before anything else
const Sentry = require("@sentry/node");

Sentry.init(${nodeOptions});`,
			id: "node",
			install: "npm install @sentry/node",
			label: "Node.js",
		},
		{
			code: `import sentry_sdk

sentry_sdk.init(${pythonOptions})`,
			id: "python",
			install: "pip install sentry-sdk",
			label: "Python",
		},
		{
			code: `import "github.com/getsentry/sentry-go"

err := sentry.Init(sentry.ClientOptions{${goOptions}})
if err != nil {
	log.Fatalf("sentry.Init: %s", err)
}
defer sentry.Flush(2 * time.Second)`,
			id: "go",
			install: "go get github.com/getsentry/sentry-go",
			label: "Go",
		},
		{
			code: `import * as Sentry from "@sentry/browser";

Sentry.init({
  dsn: "${publicDsn}",
});`,
			id: "browser",
			install: "npm install @sentry/browser",
			label: "Browser",
		},
	];
}
