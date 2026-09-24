import type { envDefaultsForDisplay } from "$lib/config";
import type { InstanceSettings } from "$lib/server/db/schema";

export type FieldErrors = Record<string, string>;

interface WizardSource {
	data: {
		envDefaults?: ReturnType<typeof envDefaultsForDisplay>;
		settings?: InstanceSettings;
	};
	form: { values?: Record<string, FormDataEntryValue> } | null | undefined;
}

/** The `:port` an origin carries, when the base domain itself doesn't : onboarding asks for one hostname, and this is how the port survives it. */
function originPort(origin: string | null, domain: string): string {
	if (!origin || domain.includes(":")) {
		return "";
	}
	try {
		const { port } = new URL(origin);
		return port ? `:${port}` : "";
	} catch {
		return "";
	}
}

/** One "required when <feature> is enabled" error per blank field, unless the field's secret is already stored. */
function requireDnsFields(
	enabled: boolean,
	feature: string,
	fields: [string, string, string, boolean?][],
): FieldErrors {
	const next: FieldErrors = {};
	if (!enabled) {
		return next;
	}
	for (const [field, fieldLabel, value, stored] of fields) {
		if (!(value.trim() || stored)) {
			next[field] = `${fieldLabel} is required when ${feature} is enabled.`;
		}
	}
	return next;
}

/**
 * Every onboarding field, pre-filled with the effective current value (a failed submission's echo, else the DB override, else the env default), plus each step's client-side validator.
 * The origin is prefilled from the effective ORIGIN rather than the portless base domain, so clicking through the defaults never rewrites a correct `http://<ip>:3000` origin to port 80.
 * The Docker socket path is deliberately never prefilled from the live-detected env default : finishing onboarding would otherwise persist that moment's detected path as a permanent override shadowing every future detector fix.
 */
export class OnboardingWizard {
	readonly #source: () => WizardSource;

	constructor(source: () => WizardSource) {
		this.#source = source;
	}

	/** The stored instance settings, undefined while waiting for an admin. */
	get settings() {
		return this.#source().data.settings;
	}

	/** The env-derived defaults each field falls back to. */
	get envDefaults() {
		return this.#source().data.envDefaults;
	}

	/** A failed submission's echoed field values. */
	get #values(): Record<string, unknown> | undefined {
		return this.#source().form?.values;
	}

	/** The echoed value of one field from a failed submission, if any. */
	#echo(field: string): string | undefined {
		return this.#values?.[field] as string | undefined;
	}

	readonly effectiveOrigin = $derived(
		this.settings?.authOrigin ?? this.envDefaults?.authOrigin ?? null,
	);
	readonly originHost = $derived.by(() => {
		if (!this.effectiveOrigin) {
			return null;
		}
		try {
			return new URL(this.effectiveOrigin).host;
		} catch {
			return null;
		}
	});
	baseDomain = $derived(
		this.#echo("baseDomain") ??
			(this.settings?.baseDomain
				? `${this.settings.baseDomain}${originPort(this.effectiveOrigin, this.settings.baseDomain)}`
				: null) ??
			this.originHost ??
			this.envDefaults?.baseDomain ??
			"",
	);
	useHttps = $derived(
		this.effectiveOrigin ? this.effectiveOrigin.startsWith("https://") : true,
	);
	readonly originPreview = $derived(
		`${this.useHttps ? "https" : "http"}://${this.baseDomain || "…"}`,
	);
	authCrossSubdomainCookies = $derived(
		this.settings?.authCrossSubdomainCookies ?? false,
	);

	dockerSocketPath = $derived(
		this.#echo("dockerSocketPath") ?? this.settings?.dockerSocketPath ?? "",
	);
	dockerNetworkName = $derived(
		this.#echo("dockerNetworkName") ??
			this.settings?.dockerNetworkName ??
			this.envDefaults?.dockerNetworkName ??
			"",
	);

	traefikEntrypoint = $derived(
		this.#echo("traefikEntrypoint") ??
			this.settings?.traefikEntrypoint ??
			this.envDefaults?.traefikEntrypoint ??
			"",
	);
	traefikCertResolver = $derived(
		this.#echo("traefikCertResolver") ??
			this.settings?.traefikCertResolver ??
			this.envDefaults?.traefikCertResolver ??
			"",
	);
	traefikDynamicConfigDir = $derived(
		this.#echo("traefikDynamicConfigDir") ??
			this.settings?.traefikDynamicConfigDir ??
			this.envDefaults?.traefikDynamicConfigDir ??
			"",
	);

	smtpEnabled = $derived(
		this.settings?.smtpEnabled ?? this.envDefaults?.smtpEnabled ?? false,
	);
	smtpHost = $derived(
		this.#echo("smtpHost") ??
			this.settings?.smtpHost ??
			this.envDefaults?.smtpHost ??
			"",
	);
	smtpPort = $derived(
		this.#echo("smtpPort") ??
			this.settings?.smtpPort?.toString() ??
			this.envDefaults?.smtpPort?.toString() ??
			"",
	);
	smtpUser = $derived(
		this.#echo("smtpUser") ??
			this.settings?.smtpUser ??
			this.envDefaults?.smtpUser ??
			"",
	);
	smtpPassword = $state("");
	smtpFrom = $derived(
		this.#echo("smtpFrom") ??
			this.settings?.smtpFrom ??
			this.envDefaults?.smtpFrom ??
			"",
	);
	smtpSecure = $derived(
		this.settings?.smtpSecure ?? this.envDefaults?.smtpSecure ?? false,
	);

	cloudflareEnabled = $derived(!!this.settings?.cloudflareZoneId);
	cloudflareZoneId = $derived(
		this.#echo("cloudflareZoneId") ?? this.settings?.cloudflareZoneId ?? "",
	);
	cloudflareApiToken = $state("");
	pangolinEnabled = $derived(!!this.settings?.pangolinApiBaseUrl);
	pangolinApiBaseUrl = $derived(
		this.#echo("pangolinApiBaseUrl") ?? this.settings?.pangolinApiBaseUrl ?? "",
	);
	pangolinOrgId = $derived(
		this.#echo("pangolinOrgId") ?? this.settings?.pangolinOrgId ?? "",
	);
	pangolinMainSiteName = $derived(
		this.#echo("pangolinMainSiteName") ??
			this.settings?.pangolinMainSiteName ??
			"",
	);
	pangolinApiToken = $state("");
	pangolinNewtEndpoint = $derived(
		this.#echo("pangolinNewtEndpoint") ??
			this.settings?.pangolinNewtEndpoint ??
			"",
	);
	pangolinNewtId = $derived(
		this.#echo("pangolinNewtId") ?? this.settings?.pangolinNewtId ?? "",
	);
	pangolinNewtSecret = $state("");

	/** Errors for the Core step's fields. */
	validateCore(): FieldErrors {
		const next: FieldErrors = {};
		if (!this.baseDomain.trim()) {
			next.baseDomain = "Base domain is required.";
		}
		return next;
	}

	/** Errors for the Docker step's fields : none, both are optional and blank means the effective default. */
	validateDocker(): FieldErrors {
		return {};
	}

	/** Errors for the Traefik step's fields. */
	validateTraefik(): FieldErrors {
		const next: FieldErrors = {};
		if (!this.traefikEntrypoint.trim()) {
			next.traefikEntrypoint = "Entrypoint is required.";
		}
		if (!this.traefikCertResolver.trim()) {
			next.traefikCertResolver = "Cert resolver is required.";
		}
		return next;
	}

	/** Errors for the Email step's fields, only when SMTP is enabled. */
	validateSmtp(): FieldErrors {
		const next: FieldErrors = {};
		if (!this.smtpEnabled) {
			return next;
		}
		if (!this.smtpHost.trim()) {
			next.smtpHost = "Host is required when SMTP is enabled.";
		}
		if (!this.smtpPort.trim()) {
			next.smtpPort = "Port is required when SMTP is enabled.";
		}
		if (!this.smtpUser.trim()) {
			next.smtpUser = "Username is required when SMTP is enabled.";
		}
		if (!this.smtpFrom.trim()) {
			next.smtpFrom = "From address is required when SMTP is enabled.";
		}
		return next;
	}

	/** Errors for the Newt fields : all-or-nothing, and only once Pangolin is on and any of them is typed. */
	#validateNewt(): FieldErrors {
		const typed = [
			this.pangolinNewtEndpoint,
			this.pangolinNewtId,
			this.pangolinNewtSecret,
		];
		if (!(this.pangolinEnabled && typed.some((value) => value.trim()))) {
			return {};
		}
		return requireDnsFields(true, "Newt", [
			["pangolinNewtEndpoint", "Newt endpoint", this.pangolinNewtEndpoint],
			["pangolinNewtId", "Newt ID", this.pangolinNewtId],
			[
				"pangolinNewtSecret",
				"Newt secret",
				this.pangolinNewtSecret,
				!!this.settings?.pangolinNewtSecretEnc,
			],
		]);
	}

	/** Errors for the DNS step's Cloudflare, Pangolin and Newt fields. */
	validateDns(): FieldErrors {
		return {
			...this.#validateNewt(),
			...requireDnsFields(this.cloudflareEnabled, "Cloudflare", [
				["cloudflareZoneId", "Zone ID", this.cloudflareZoneId],
				[
					"cloudflareApiToken",
					"API token",
					this.cloudflareApiToken,
					!!this.settings?.cloudflareApiTokenEnc,
				],
			]),
			...requireDnsFields(this.pangolinEnabled, "Pangolin", [
				["pangolinApiBaseUrl", "API base URL", this.pangolinApiBaseUrl],
				["pangolinOrgId", "Org ID", this.pangolinOrgId],
				["pangolinMainSiteName", "Site name", this.pangolinMainSiteName],
				[
					"pangolinApiToken",
					"API token",
					this.pangolinApiToken,
					!!this.settings?.pangolinApiTokenEnc,
				],
			]),
		};
	}
}
