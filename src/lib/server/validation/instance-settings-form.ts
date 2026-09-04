import { applyInstanceSettings } from "$lib/config";
import type { InstanceSettingsDTO } from "$lib/dto/instance-settings-dto";
import { rebuildAuth } from "$lib/services/auth";

export function nullableText(formData: FormData, key: string): string | null {
	const value = (formData.get(key) as string | null)?.trim();
	return value ? value : null;
}

export function checkbox(formData: FormData, key: string): boolean {
	return formData.get(key) === "on";
}

export function applyAndRebuild(settings: InstanceSettingsDTO) {
	applyInstanceSettings(settings.toConfigOverride());
	rebuildAuth();
}
