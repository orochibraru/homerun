export const UPDATE_CHANNELS = ["stable", "canary", "nightly"] as const;

export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];

/** Whether `value` names a release channel self-update can follow. */
export function isUpdateChannel(value: unknown): value is UpdateChannel {
	return UPDATE_CHANNELS.includes(value as UpdateChannel);
}
