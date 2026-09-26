import { stackScopedSlug } from "$lib/slug";
export const DOMAIN_RE =
	/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export interface ServiceDomainFields {
	defaultDomainEnabled: boolean;
	domains: string[];
	primaryDomain: string | null;
	slug: string;
}

/** The `<slug>.<baseDomain>` hostname every public service gets, prefixed with its stack's slug when it has one. */
export function defaultHostname(
	slug: string,
	stackSlug: string | null | undefined,
	baseDomain: string,
): string {
	return `${stackScopedSlug(stackSlug, slug)}.${baseDomain}`;
}

/** Every hostname Traefik routes to the service: the default one first when it's kept, then the service's own domains. */
export function serviceHostnames(
	svc: ServiceDomainFields,
	stackSlug: string | null | undefined,
	baseDomain: string,
): string[] {
	return [
		...(svc.defaultDomainEnabled
			? [defaultHostname(svc.slug, stackSlug, baseDomain)]
			: []),
		...svc.domains,
	];
}

/** The hostname shown as the service's link: its chosen main domain while that's still routed, else the first routed one. Null when nothing is routed. */
export function primaryHostname(
	svc: ServiceDomainFields,
	stackSlug: string | null | undefined,
	baseDomain: string,
): string | null {
	const hostnames = serviceHostnames(svc, stackSlug, baseDomain);
	if (svc.primaryDomain && hostnames.includes(svc.primaryDomain)) {
		return svc.primaryDomain;
	}
	return hostnames[0] ?? null;
}

/** Whether `hostname` is `baseDomain` itself or one of its subdomains. */
export function isUnderDomain(hostname: string, baseDomain: string): boolean {
	return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
}

/** Trims, lowercases, drops blanks and duplicates, keeping the first occurrence's order. */
export function normalizeDomains(raw: readonly string[]): string[] {
	return [
		...new Set(
			raw.map((domain) => domain.trim().toLowerCase()).filter(Boolean),
		),
	];
}

/** A branch name as one DNS label: lowercased, anything outside `a-z0-9` turned into single dashes, trimmed of dashes and cut to 63 characters. */
export function branchLabel(branch: string): string {
	return (
		branch
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 63)
			.replace(/-+$/, "") || "branch"
	);
}

/**
 * A preview's hostname from its parent's domain template: `{pr}` becomes the
 * pull request number, `{branch}` its branch as one DNS label (`feat/login`
 * becomes `feat-login`), `{slug}` the parent's slug. Null for a blank template.
 */
export function renderPreviewDomain(
	template: string | null | undefined,
	values: { branch: string | null; pr: number; slug: string },
): string | null {
	const trimmed = template?.trim().toLowerCase();
	if (!trimmed) {
		return null;
	}
	return trimmed
		.replaceAll("{pr}", String(values.pr))
		.replaceAll("{branch}", branchLabel(values.branch ?? `pr-${values.pr}`))
		.replaceAll("{slug}", values.slug);
}

/** Why a preview domain template can't be used, or null when it's fine: it must name `{pr}` or `{branch}` so each preview gets its own hostname, and render to a valid domain. */
export function previewDomainTemplateProblem(template: string): string | null {
	const trimmed = template.trim().toLowerCase();
	if (!(trimmed.includes("{pr}") || trimmed.includes("{branch}"))) {
		return "The template needs {pr} or {branch}, or every preview would get the same domain.";
	}
	const sample = renderPreviewDomain(trimmed, {
		branch: "feature-branch",
		pr: 123,
		slug: "app",
	});
	if (!(sample && DOMAIN_RE.test(sample))) {
		return `"${template.trim()}" doesn't make a valid domain (it renders to "${sample}").`;
	}
	return null;
}

/**
 * Env values with every one of `from` (the parent's hostnames) replaced by
 * `to` (the preview's), matched as whole hostnames so `api.example.com` is
 * left alone when replacing `example.com`. What a preview's `ORIGIN`,
 * `PUBLIC_URL` and the like need, since they're copied from its parent.
 */
export function rewriteHostnames(
	env: Record<string, string>,
	from: readonly string[],
	to: string | null,
): Record<string, string> {
	const hosts = from.filter((host) => host && host !== to);
	if (!to || hosts.length === 0) {
		return env;
	}
	const pattern = new RegExp(
		`(?<![a-z0-9.-])(?:${hosts.map((host) => host.replaceAll(".", "\\.")).join("|")})(?![a-z0-9.-])`,
		"gi",
	);
	return Object.fromEntries(
		Object.entries(env).map(([key, value]) => [
			key,
			value.replace(pattern, to),
		]),
	);
}
