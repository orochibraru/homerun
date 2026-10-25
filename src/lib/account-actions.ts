import { toast } from "svelte-sonner";
import { signOut } from "#lib/auth-client.js";
import { setUiMode } from "#lib/remote/ui-mode.remote.js";
import { toastError } from "#lib/toast.js";
import { UI_MODE_LABELS, type UiMode } from "#lib/ui-mode.js";
import { refreshAll } from "$app/navigation";

async function signOutCallback(): Promise<void> {
	await signOut();
	await refreshAll();
}

async function switchModeCallback(mode: UiMode): Promise<void> {
	await setUiMode(mode);
	await refreshAll();
}

/** Signs the account out and reloads every route's data, which sends it to the sign-in page; reported with a promise toast. */
export function handleSignOut() {
	return toast.promise(signOutCallback, {
		error: (error) => toastError(error, "Failed to sign you out"),
		loading: "Signing you out",
		success: "Signed you out successfully",
	});
}

/** Saves `mode` as the account's interface mode and reloads every route's data so the nav and pages follow; reported with a promise toast. */
export function handleSwitchMode(mode: UiMode) {
	return toast.promise(switchModeCallback(mode), {
		error: (error) => toastError(error, "Couldn't switch the interface mode."),
		loading: `Switching to ${UI_MODE_LABELS[mode].toLowerCase()} mode`,
		success: `${UI_MODE_LABELS[mode]} mode on.`,
	});
}
