import { applyInstanceSettings } from "$lib/config";
import type { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { rebuildAuth } from "$lib/services/auth";
import { syncDashboardDns } from "$lib/services/dns.service";
import { DockerService } from "$lib/services/docker.service";

/** A trimmed text field from the form, or null when it is missing or blank. */
export function nullableText(formData: FormData, key: string): string | null {
	const value = (formData.get(key) as string | null)?.trim();
	return value ? value : null;
}

/** Whether a checkbox field was ticked. */
export function checkbox(formData: FormData, key: string): boolean {
	return formData.get(key) === "on";
}

/**
 * Applies freshly saved instance settings to the running process : merges them
 * into the live config, rebuilds the auth instance, and resyncs the dashboard's
 * Traefik router and DNS record in the background without waiting for either.
 */
export function applyAndRebuild(settings: InstanceSettingsDTO) {
	applyInstanceSettings(settings.toConfigOverride());
	rebuildAuth();
	void DockerService.syncDashboardRouter();
	void syncDashboardDns();
}
