export const RESTORE_MODES = [
	{
		description:
			"Unpacks the backup over the current data. Whatever it replaces is gone.",
		id: "replace",
		name: "Replace directly",
	},
	{
		description:
			"Backs the current data up first, then restores once that backup succeeded, so you can go back to it.",
		id: "backupFirst",
		name: "Back up the current data first",
	},
	{
		description:
			"Leaves the current volume untouched: restores into a new volume and redeploys the service with it as a new revision. Rolling back with its config puts the old volume back.",
		id: "revision",
		name: "Deploy as a revision",
	},
] as const;

export type RestoreMode = (typeof RESTORE_MODES)[number]["id"];
