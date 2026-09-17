export const HOST_COMMAND_IMAGE = "alpine";

export const HOST_COMMAND_TAG = "3";

/**
 * The helper container's command for running `command` on the Docker host
 * itself rather than inside any container : busybox `nsenter` into PID 1's
 * mount, UTS, IPC, network and PID namespaces, then `sh -c`. Only works from a
 * privileged container sharing the host's PID namespace, see
 * `CronJobService`'s host command runner.
 */
export function hostCommandArgs(command: string): string[] {
	return [
		"nsenter",
		"-t",
		"1",
		"-m",
		"-u",
		"-i",
		"-n",
		"-p",
		"--",
		"sh",
		"-c",
		command,
	];
}
