export const PACKAGE_REGISTRY_KINDS = ["npm", "pypi"] as const;

export type PackageRegistryKind = (typeof PACKAGE_REGISTRY_KINDS)[number];

export interface PackageRegistryKindInfo {
	description: string;
	hostPrefix: string;
	label: string;
	title: string;
}

export const PACKAGE_REGISTRY_INFO: Record<
	PackageRegistryKind,
	PackageRegistryKindInfo
> = {
	npm: {
		description:
			"A private npm registry (Verdaccio). Packages you publish stay here, everything else is fetched from npmjs.org and cached.",
		hostPrefix: "npm",
		label: "npm",
		title: "npm Registry",
	},
	pypi: {
		description:
			"A private Python package index (pypiserver). Packages you upload stay here, anything it doesn't hold is redirected to pypi.org.",
		hostPrefix: "pypi",
		label: "PyPI",
		title: "PyPI Registry",
	},
};

export interface PackageRegistryCredentials {
	secret: string;
	username: string;
}

export interface UsageSnippet {
	code: string;
	language: "shellscript" | "text";
	title: string;
}

const USERNAME_PLACEHOLDER = "<username>";
const SECRET_PLACEHOLDER = "<token>";

/** Narrows a route param or stored value to a package registry kind. */
export function isPackageRegistryKind(
	value: unknown,
): value is PackageRegistryKind {
	return (
		typeof value === "string" &&
		(PACKAGE_REGISTRY_KINDS as readonly string[]).includes(value)
	);
}

/** The `_auth` value an `.npmrc` carries for a Basic-auth registry: base64 of `username:secret`. */
export function npmAuthValue(credentials: PackageRegistryCredentials): string {
	return btoa(`${credentials.username}:${credentials.secret}`);
}

/**
 * The files and commands a client needs to install from and publish to a
 * package registry at `baseUrl` (ending in a slash), with the token filled
 * in when `credentials` is given and placeholders otherwise.
 */
export function packageRegistryUsage(
	kind: PackageRegistryKind,
	baseUrl: string,
	credentials: PackageRegistryCredentials | null,
): UsageSnippet[] {
	const url = new URL(baseUrl);
	if (kind === "npm") {
		const auth = credentials
			? npmAuthValue(credentials)
			: `<base64 of ${USERNAME_PLACEHOLDER}:${SECRET_PLACEHOLDER}>`;
		return [
			{
				code: `registry=${url.href}\n//${url.host}${url.pathname}:_auth=${auth}\n`,
				language: "text",
				title: ".npmrc",
			},
			{
				code: `npm publish --registry ${url.href}`,
				language: "shellscript",
				title: "Publish a package",
			},
		];
	}
	const username = credentials?.username ?? USERNAME_PLACEHOLDER;
	const secret = credentials?.secret ?? SECRET_PLACEHOLDER;
	return [
		{
			code: `[global]\nindex-url = ${url.protocol}//${username}:${secret}@${url.host}${url.pathname}simple/\n`,
			language: "text",
			title: "pip.conf",
		},
		{
			code: `twine upload --repository-url ${url.href} -u ${username} -p ${secret} dist/*`,
			language: "shellscript",
			title: "Upload a package",
		},
	];
}
