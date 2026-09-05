import {
	cronJobSchema,
	DEFAULT_CRON_JOB_TIMEOUT_SECONDS,
} from "$lib/server/validation/cron-job";
import { parseEnvVars } from "$lib/server/validation/service";
import { CronService } from "$lib/services/cron.service";
import { encryptSecret } from "$lib/services/secrets";

export interface ParsedCronJobForm {
	command: string | null;
	description: string | null;
	enabled: boolean;
	envVars: Record<string, string>;
	image: string | null;
	kind: "image" | "exec";
	name: string;
	registryPasswordEnc: string | null;
	registryUrl: string | null;
	registryUsername: string | null;
	schedule: string;
	tag: string;
	timeoutSeconds: number;
}

export type CronJobFormResult =
	| { error: string }
	| { parsed: ParsedCronJobForm };

export function parseCronJobForm(
	formData: FormData,
	options: { isAdmin: boolean },
): CronJobFormResult {
	const result = cronJobSchema.safeParse(Object.fromEntries(formData));
	if (!result.success) {
		const first = result.error.issues[0];
		return { error: first?.message ?? "Check the form for errors." };
	}
	const input = result.data;

	if (input.kind === "exec" && !options.isAdmin) {
		return { error: "Only an admin can create a host command job." };
	}
	if (!CronService.parseCronSchedule(input.schedule)) {
		return {
			error:
				'Invalid schedule : use standard 5-field cron syntax (e.g. "0 3 * * *").',
		};
	}

	const registryPassword = input.registryPassword?.trim() || null;

	return {
		parsed: {
			command: input.command?.trim() || null,
			description: input.description?.trim() || null,
			enabled: input.enabled,
			envVars: parseEnvVars(formData),
			image: input.kind === "image" ? (input.image?.trim() ?? null) : null,
			kind: input.kind,
			name: input.name.trim(),
			registryPasswordEnc: registryPassword
				? encryptSecret(registryPassword)
				: null,
			registryUrl: input.registryUrl?.trim() || null,
			registryUsername: input.registryUsername?.trim() || null,
			schedule: input.schedule.trim(),
			tag: input.tag?.trim() || "latest",
			timeoutSeconds: input.timeoutSeconds ?? DEFAULT_CRON_JOB_TIMEOUT_SECONDS,
		},
	};
}
