import type {
	InstanceSettingsCloudflareInput,
	InstanceSettingsDTO,
	InstanceSettingsPangolinInput,
} from "$lib/dto/instance-settings-dto";
import { CloudflareService } from "$lib/services/cloudflare.service";
import { PangolinService } from "$lib/services/pangolin.service";
import { checkbox, nullableText } from "./instance-settings-form";

export type DnsTestOutcome =
	| { detail: string | null; ok: true }
	| { error: string; ok: false };

type PangolinTargetFields = Pick<
	InstanceSettingsPangolinInput,
	"pangolinOwnsAuth" | "pangolinTargetHost" | "pangolinTargetPort"
>;

/** A typed secret field, or undefined when left blank so the stored value is kept. */
function secretField(formData: FormData, key: string): string | undefined {
	return (formData.get(key) as string | null)?.trim() || undefined;
}

/**
 * What's wrong with the Newt fields of a settings or onboarding form, or null
 * when they're fine: all blank (the tunnel client runs elsewhere) or
 * endpoint, id and secret all set, the secret either typed or already stored.
 */
export function newtFieldsError(
	formData: FormData,
	settings: InstanceSettingsDTO,
): string | null {
	const endpoint = nullableText(formData, "pangolinNewtEndpoint");
	const id = nullableText(formData, "pangolinNewtId");
	const typedSecret = secretField(formData, "pangolinNewtSecret");
	if (!(endpoint || id || typedSecret)) {
		return null;
	}
	if (!endpoint) {
		return "Newt endpoint is required to run Newt on this host.";
	}
	if (!URL.canParse(endpoint)) {
		return "Newt endpoint must be a full URL, like https://pangolin.example.com.";
	}
	if (!id) {
		return "Newt ID is required to run Newt on this host.";
	}
	if (!(typedSecret || settings.toJSON().pangolinNewtSecretEnc)) {
		return "Newt secret is required to run Newt on this host.";
	}
	return null;
}

/** The Cloudflare section of a settings or onboarding form, ready for `updateCloudflare`. */
export function cloudflareInputFromForm(
	formData: FormData,
): InstanceSettingsCloudflareInput {
	return {
		cloudflareApiToken: secretField(formData, "cloudflareApiToken"),
		cloudflareZoneId: nullableText(formData, "cloudflareZoneId"),
	};
}

/**
 * The Pangolin section of a settings or onboarding form, ready for
 * `updatePangolin`. The target host, target port and SSO ownership come from
 * `preserve` when given, for a form that doesn't show those fields.
 */
export function pangolinInputFromForm(
	formData: FormData,
	preserve?: PangolinTargetFields,
): InstanceSettingsPangolinInput {
	const portRaw = (formData.get("pangolinTargetPort") as string | null)?.trim();
	const port = portRaw ? Number.parseInt(portRaw, 10) : null;
	return {
		pangolinApiBaseUrl: nullableText(formData, "pangolinApiBaseUrl"),
		pangolinApiToken: secretField(formData, "pangolinApiToken"),
		pangolinMainSiteName: nullableText(formData, "pangolinMainSiteName"),
		pangolinNewtEndpoint: nullableText(formData, "pangolinNewtEndpoint"),
		pangolinNewtId: nullableText(formData, "pangolinNewtId"),
		pangolinNewtSecret: secretField(formData, "pangolinNewtSecret"),
		pangolinOrgId: nullableText(formData, "pangolinOrgId"),
		...(preserve ?? {
			pangolinOwnsAuth: checkbox(formData, "pangolinOwnsAuth"),
			pangolinTargetHost: nullableText(formData, "pangolinTargetHost"),
			pangolinTargetPort: Number.isFinite(port) ? port : null,
		}),
	};
}

/**
 * Checks the Cloudflare zone id and token typed into a form, falling back to
 * the stored token when the field is blank: the token must read the zone and
 * its DNS records, and the zone must hold `baseDomain`.
 */
export async function testCloudflareFromForm(
	formData: FormData,
	settings: InstanceSettingsDTO,
	baseDomain: string,
): Promise<DnsTestOutcome> {
	const zoneId = nullableText(formData, "cloudflareZoneId");
	if (!zoneId) {
		return { error: "Enter a zone id first.", ok: false };
	}
	const token =
		secretField(formData, "cloudflareApiToken") ??
		settings.decryptCloudflareApiToken();
	if (!token) {
		return { error: "Enter an API token first.", ok: false };
	}
	const result = await CloudflareService.verifyZoneAccess(
		token,
		zoneId,
		baseDomain,
	);
	if (!result.success) {
		return {
			error: `Couldn't verify zone access: ${result.error}`,
			ok: false,
		};
	}
	return { detail: result.detail ?? null, ok: true };
}

/**
 * Checks the whole Pangolin configuration typed into a form, not just that the
 * token authenticates: the site must exist and a registered domain must cover
 * `baseDomain`, since without either no resource can ever be created. Falls
 * back to the stored token when the field is blank.
 */
export async function testPangolinFromForm(
	formData: FormData,
	settings: InstanceSettingsDTO,
	baseDomain: string,
): Promise<DnsTestOutcome> {
	const baseUrl = nullableText(formData, "pangolinApiBaseUrl");
	const orgId = nullableText(formData, "pangolinOrgId");
	if (!(baseUrl && orgId)) {
		return {
			error: "Enter an API base URL and org id first.",
			ok: false,
		};
	}
	const token =
		secretField(formData, "pangolinApiToken") ??
		settings.decryptPangolinApiToken();
	if (!token) {
		return { error: "Enter an API token first.", ok: false };
	}
	const result = await PangolinService.verifyConnection({
		baseDomain,
		baseUrl,
		orgId,
		siteName: nullableText(formData, "pangolinMainSiteName"),
		token,
	});
	if (!result.success) {
		return {
			error: result.error ?? "Couldn't verify the Pangolin connection.",
			ok: false,
		};
	}
	return { detail: result.detail ?? null, ok: true };
}
