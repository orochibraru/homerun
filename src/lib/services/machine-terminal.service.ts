import { InstanceSettingsDTO } from "#lib/dto/instance-settings-dto.js";
import { RemoteHostDTO } from "#lib/dto/remote-host-dto.js";
import { Logger } from "#lib/logger.js";
import { generateSshKeyPair } from "#lib/server/ssh-keys.js";
import { WorkerClient, WorkerRequestError } from "#lib/server/worker-client.js";
import { DockerService } from "./docker.service.ts";

const logger = new Logger("MachineTerminal");

/** The id of this server itself among the machines. */
export const LOCAL_MACHINE = "local";

/** Where a machine's terminal connects. */
export interface SshTarget {
	host: string;
	hostKey: string | null;
	port: number;
	user: string;
}

/** One machine the Terminal page lists. */
export interface Machine {
	/** A remote host's build role or agent address, null for this server. */
	detail: string | null;
	id: string;
	name: string;
	ssh: SshTarget | null;
}

/** The size the browser's terminal opens at. */
export interface TerminalSize {
	cols: number;
	rows: number;
}

/** A terminal that couldn't open, with the status the route answers. */
export class MachineTerminalError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
	}
}

/** A remote host's SSH settings, null until they're set. */
function remoteTarget(host: RemoteHostDTO): SshTarget | null {
	const row = host.toJSON();
	return row.sshHost && row.sshUser
		? {
				host: row.sshHost,
				hostKey: row.sshHostKey,
				port: row.sshPort ?? 22,
				user: row.sshUser,
			}
		: null;
}

/**
 * Shells on the machines themselves, this server and the remote hosts, over
 * SSH from the worker: Homerun holds one key pair, whose public half goes in
 * each machine's authorized_keys, and records every machine's host key on the
 * first connection so a changed one is refused. The session then streams
 * through the same terminal plumbing as a container's.
 */
class MachineTerminalServiceClass {
	/** The public key to add to each machine's authorized_keys, generating the pair the first time. */
	async publicKey(): Promise<string> {
		return (await this.#keyPair()).publicKey;
	}

	/** This server and every remote host, with their SSH settings. */
	async machines(): Promise<Machine[]> {
		const [settings, hosts] = await Promise.all([
			InstanceSettingsDTO.get(),
			RemoteHostDTO.list(),
		]);
		return [
			{
				detail: null,
				id: LOCAL_MACHINE,
				name: "This server",
				ssh: settings.sshTarget,
			},
			...hosts.map((host) => ({
				detail: host.kind === "agent" ? host.agentUrl : host.dockerHost,
				id: host.id,
				name: host.name,
				ssh: remoteTarget(host),
			})),
		];
	}

	/** One machine by id, null when there's no such remote host. */
	async machine(id: string): Promise<Machine | null> {
		return (await this.machines()).find((machine) => machine.id === id) ?? null;
	}

	/**
	 * Sets where a machine's terminal connects. Changing the host forgets the
	 * recorded host key; clearing host or user turns the terminal off.
	 *
	 * @throws MachineTerminalError 404 for an unknown machine.
	 */
	async configure(
		id: string,
		input: { host: string | null; port: number | null; user: string | null },
	): Promise<void> {
		if (id === LOCAL_MACHINE) {
			await (await InstanceSettingsDTO.get()).updateSshTarget(input);
			return;
		}
		const host = await RemoteHostDTO.get(id);
		if (!host) {
			throw new MachineTerminalError(404, "That machine doesn't exist.");
		}
		const row = host.toJSON();
		await host.update({
			sshHost: input.host,
			sshHostKey: input.host === row.sshHost ? row.sshHostKey : null,
			sshPort: input.port,
			sshUser: input.user,
		});
	}

	/**
	 * Opens a shell on a machine for `userId` and returns the session id,
	 * recording the machine's host key when this is the first connection.
	 *
	 * @throws MachineTerminalError when the machine is unknown or has no SSH
	 *   settings, its host key changed, or the connection fails.
	 */
	async open(
		machineId: string,
		userId: string,
		size: TerminalSize,
	): Promise<string> {
		const machine = await this.machine(machineId);
		if (!machine) {
			throw new MachineTerminalError(404, "That machine doesn't exist.");
		}
		if (!machine.ssh) {
			throw new MachineTerminalError(
				400,
				"Set this machine's SSH host and user first.",
			);
		}
		const { privateKey } = await this.#keyPair();
		const opened = await WorkerClient.post<{
			hostKey: string;
			sessionId: string;
		}>("/v1/ssh", {
			cols: size.cols,
			host: machine.ssh.host,
			hostKey: machine.ssh.hostKey ?? "",
			port: machine.ssh.port,
			privateKey,
			rows: size.rows,
			user: machine.ssh.user,
		}).catch((err: unknown) => {
			throw new MachineTerminalError(
				err instanceof WorkerRequestError && err.status === 409 ? 409 : 502,
				err instanceof Error ? err.message : String(err),
			);
		});
		if (!machine.ssh.hostKey && opened.hostKey) {
			await this.#recordHostKey(machineId, opened.hostKey);
		}
		DockerService.registerTerminalSession(opened.sessionId, {
			containerId: `ssh://${machine.ssh.user}@${machine.ssh.host}`,
			serviceId: `machine:${machineId}`,
			userId,
		});
		logger.info(
			`Machine terminal opened: machine=${machineId} target=${machine.ssh.user}@${machine.ssh.host} session=${opened.sessionId} user=${userId}`,
		);
		return opened.sessionId;
	}

	/** Trusts the host key a machine presented on its first connection. */
	async #recordHostKey(machineId: string, hostKey: string): Promise<void> {
		if (machineId === LOCAL_MACHINE) {
			await (await InstanceSettingsDTO.get()).recordSshHostKey(hostKey);
			return;
		}
		await (await RemoteHostDTO.get(machineId))?.update({ sshHostKey: hostKey });
	}

	/** The instance's SSH key pair, generated and stored the first time it's needed. */
	async #keyPair(): Promise<{ privateKey: string; publicKey: string }> {
		const settings = await InstanceSettingsDTO.get();
		const existing = settings.sshKeyPair;
		if (existing) {
			return existing;
		}
		const pair = generateSshKeyPair("homerun");
		await settings.saveSshKeyPair(pair);
		logger.info("Generated the SSH key pair for machine terminals");
		return pair;
	}
}

export const MachineTerminalService = new MachineTerminalServiceClass();
