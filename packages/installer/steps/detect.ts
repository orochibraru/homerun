import process from "node:process";
import { commandExists } from "../exec";

export interface PackageManager {
	kind: "apt" | "dnf" | "yum";
	install: string[];
}

/** Host/environment preflight checks, grouped as a class purely for consistency with the rest of installer/steps/ : none of these carry instance state, each is a one-shot check. */
class InstallerDetector {
	/** Best-effort : apt is the primary target (Debian/Ubuntu, the overwhelming majority of homelab/VPS installs); dnf/yum are supported on a "should work, less exercised" basis. */
	async detectPackageManager(): Promise<PackageManager> {
		if (await commandExists("apt-get")) {
			return { install: ["apt-get", "install", "-y"], kind: "apt" };
		}
		if (await commandExists("dnf")) {
			return { install: ["dnf", "install", "-y"], kind: "dnf" };
		}
		if (await commandExists("yum")) {
			return { install: ["yum", "install", "-y"], kind: "yum" };
		}
		throw new Error(
			"No supported package manager found (apt-get, dnf, yum). This installer targets Debian/Ubuntu/RHEL-family Linux : install Docker + rootless-extras by hand elsewhere.",
		);
	}

	requireLinux(): void {
		if (process.platform !== "linux") {
			throw new Error(
				`This installer sets up a Linux server (systemd + rootless Docker) : refusing to run on ${process.platform}. Run it on the target server itself, not your workstation.`,
			);
		}
	}

	requireRoot(): void {
		// Bun exposes process.getuid on Linux/macOS (not Windows, which requireLinux already rejects).
		if (typeof process.getuid === "function" && process.getuid() !== 0) {
			throw new Error(
				"This installer needs root (it creates a system user, installs packages, and writes systemd units) : re-run with sudo.",
			);
		}
	}

	/**
	 * Best-effort "what address is this box actually reachable at": the source
	 * IP of the route out to the internet, falling back to the first address
	 * `hostname -I` reports. Loopback is never returned : an origin of
	 * localhost is exactly what makes the first sign-up on a fresh install
	 * fail with better-auth's "Invalid origin" once the dashboard is opened
	 * from any other machine (SvelteKit normalizes event.url to ORIGIN, so the
	 * derived trusted origin is localhost while the browser's Origin header is
	 * the real address).
	 */
	async hostAddress(): Promise<string | null> {
		const route = await this.#output(["ip", "-4", "route", "get", "1.1.1.1"]);
		const hostnames = await this.#output(["hostname", "-I"]);
		const candidates = [
			route?.match(/\bsrc\s+(\S+)/)?.[1],
			...(hostnames?.trim().split(/\s+/) ?? []),
		];
		return (
			candidates.find(
				(address) =>
					address && address !== "::1" && !address.startsWith("127."),
			) ?? null
		);
	}

	async #output(cmd: string[]): Promise<string | null> {
		try {
			const proc = Bun.spawn(cmd, { stderr: "ignore", stdout: "pipe" });
			const stdout = await new Response(proc.stdout).text();
			return (await proc.exited) === 0 ? stdout : null;
		} catch {
			return null;
		}
	}

	/** "amd64"/"arm64": matches this repo's own release-asset naming (`scripts/build-packages.ts`'s `homerun-<pkg>-<arch>` filenames), not Node's "x64"/"arm64" `process.arch` values. */
	arch(): "amd64" | "arm64" {
		if (process.arch === "arm64") {
			return "arm64";
		}
		return "amd64";
	}
}

export const Detector = new InstallerDetector();
