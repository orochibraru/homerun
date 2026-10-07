import {
	type CronJobInput,
	cronJobSchema,
	DEFAULT_CRON_JOB_TIMEOUT_SECONDS,
} from "#lib/server/validation/cron-job.js";
import { parseEnvVars } from "#lib/server/validation/service.js";
import { CronService } from "#lib/services/cron.service.js";
import { encryptSecret } from "#lib/services/secrets.js";

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
	remoteHostId: string | null;
	schedule: string;
	tag: string;
	timeoutSeconds: number;
}

export type CronJobFormResult =
	| { error: string }
	| { parsed: ParsedCronJobForm };

function validate(
	input: CronJobInput,
	options: { hostAccess: boolean },
): string | null {
	if (input.kind === "exec" && !options.hostAccess) {
		return "A host command job needs write access to System.";
	}
	if (!CronService.parseCronSchedule(input.schedule)) {
		return 'Invalid schedule : use standard 5-field cron syntax (e.g. "0 3 * * *").';
	}
	return null;
}

/**
 * Validates a cron job's fields and normalises them into DTO-ready columns :
 * trims text, drops fields that don't apply to the job's kind, encrypts the
 * registry password and defaults the tag and timeout. `raw` is the form's
 * fields or a JSON body, `envVars` its variables.
 *
 * @param options.hostAccess Whether the caller may create host command (exec) jobs, which needs write access to System.
 * @returns The parsed fields, or the first validation error message.
 */
export function parseCronJobInput(
	raw: Record<string, unknown>,
	envVars: Record<string, string>,
	options: { hostAccess: boolean },
): CronJobFormResult {
	const result = cronJobSchema.safeParse(raw);
	if (!result.success) {
		const first = result.error.issues[0];
		return { error: first?.message ?? "Check the form for errors." };
	}
	const input = result.data;

	const invalid = validate(input, options);
	if (invalid) {
		return { error: invalid };
	}

	const registryPassword = input.registryPassword?.trim() || null;

	return {
		parsed: {
			command: input.command?.trim() || null,
			description: input.description?.trim() || null,
			enabled: input.enabled,
			envVars,
			image: input.kind === "image" ? (input.image?.trim() ?? null) : null,
			kind: input.kind,
			name: input.name.trim(),
			registryPasswordEnc: registryPassword
				? encryptSecret(registryPassword)
				: null,
			registryUrl: input.registryUrl?.trim() || null,
			registryUsername: input.registryUsername?.trim() || null,
			remoteHostId:
				input.kind === "image" ? input.remoteHostId?.trim() || null : null,
			schedule: input.schedule.trim(),
			tag: input.tag?.trim() || "latest",
			timeoutSeconds: input.timeoutSeconds ?? DEFAULT_CRON_JOB_TIMEOUT_SECONDS,
		},
	};
}

/** Validates a submitted cron job form, see `parseCronJobInput`. */
export function parseCronJobForm(
	formData: FormData,
	options: { hostAccess: boolean },
): CronJobFormResult {
	return parseCronJobInput(
		Object.fromEntries(formData),
		parseEnvVars(formData),
		options,
	);
}
