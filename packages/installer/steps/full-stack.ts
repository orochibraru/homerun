import type { StepRunner } from "../exec";
import { AuthSecretInstaller } from "./auth-secret";
import { ReleaseAssets } from "./release";

class FullStackInstallerService {
	/** --mode=full: brings up the actual Homerun app (Traefik + Postgres + the app itself, all as pulled images) under the same rootless user/daemon as everything else this installer sets up. Returns the compose file path it wrote, for the "how to check on it" hint printed at the end. */
	async bringUpFullStack(
		run: StepRunner,
		username: string,
		version: string,
		dockerSocket: string,
	): Promise<string> {
		const composeDir = `/home/${username}/homerun`;
		const composePath = `${composeDir}/compose.yaml`;
		const configPath = `${composeDir}/homerun.yaml`;
		const env = {
			DOCKER_HOST: `unix://${dockerSocket}`,
			HOME: `/home/${username}`,
		};

		await run.run(["mkdir", "-p", composeDir], { as: username });
		await this.#allowPrivilegedPorts(run);
		await AuthSecretInstaller.ensureAuthSecret(run, username, composeDir);
		await this.#ensureConfigFile(run, configPath, dockerSocket);
		await run.writeFile(
			composePath,
			this.#fullStackCompose(ReleaseAssets.imageRef(version), dockerSocket),
		);
		await run.run(["chown", "-R", `${username}:${username}`, composeDir]);

		await run.run(["docker", "compose", "-f", composePath, "pull"], {
			as: username,
			cwd: composeDir,
			env,
		});
		await run.run(["docker", "compose", "-f", composePath, "up", "-d"], {
			as: username,
			cwd: composeDir,
			env,
		});

		return composePath;
	}

	/**
	 * Real, tested-live finding (`--mode=full` against a real disposable
	 * Multipass Ubuntu 24.04 VM): rootless Docker's RootlessKit port driver
	 * refuses to bind ports below 1024 by default (Linux's own
	 * unprivileged-port restriction, not a Docker bug), so Traefik's 80/443
	 * publish failed outright with "cannot expose privileged port 80,
	 * ... bind: permission denied" the first time this ran for real,
	 * `docker compose up` never got the stack running at all. This is
	 * Docker's own documented fix for exactly this case
	 * (https://docs.docker.com/engine/security/rootless/#exposing-privileged-ports):
	 * lower `net.ipv4.ip_unprivileged_port_start` so any user can bind >=80.
	 * Written persistently (survives reboot, `/etc/sysctl.d/`) and applied
	 * immediately via `sysctl -p` so this run doesn't also need one.
	 */
	async #allowPrivilegedPorts(run: StepRunner): Promise<void> {
		const sysctlConfPath = "/etc/sysctl.d/90-homerun-rootless-ports.conf";
		await run.writeFile(
			sysctlConfPath,
			"net.ipv4.ip_unprivileged_port_start=80\n",
		);
		await run.run(["sysctl", "-p", sysctlConfPath]);
	}

	/** Writes homerun.yaml once, same "never clobber an existing value" rule as AuthSecretInstaller's own .env. */
	async #ensureConfigFile(
		run: StepRunner,
		configPath: string,
		dockerSocket: string,
	): Promise<void> {
		if (await Bun.file(configPath).exists()) {
			return;
		}
		await run.writeFile(
			configPath,
			`baseDomain: localhost
auth:
  origin: http://localhost:3000
docker:
  networkName: homerun
  socketPath: ${dockerSocket}
`,
		);
	}

	/**
	 * Real, tested-live finding (`--mode=full` against a real disposable
	 * Multipass Ubuntu 24.04 VM): the AUTH_SECRET line's `${VAR:?message}`
	 * default-value error message originally read "...missing from .env :
	 * the installer...", and `docker compose pull` failed outright with
	 * `go-yaml load error ... mapping values are not allowed in this
	 * context` — an unquoted YAML scalar containing " : " (colon+space) is
	 * read as the start of a nested mapping, not plain text. Fixed by
	 * quoting the whole `${...}` expression (the correct general fix,
	 * matches how real-world compose files handle this) and, defensively,
	 * rewording the message to avoid " : " entirely.
	 *
	 * Second real, tested-live finding on the same run: postgres's `volumes`
	 * entry originally mounted the volume straight at
	 * `/var/lib/postgresql/data` (this repo's *own* pre-18 convention), which
	 * the `postgres:18-alpine` image refuses to start against — 18+'s
	 * official image expects a mount at the `/var/lib/postgresql` parent
	 * directory instead (it manages its own versioned subdirectory beneath
	 * that) and exits immediately with "these Docker images are configured
	 * to store database data in a format which is compatible with
	 * pg_ctlcluster" when it finds a mount at the old flat path instead.
	 * `postgres-1` reported unhealthy and `app`/`postgres`'s own
	 * `depends_on: condition: service_healthy` then failed the whole
	 * `docker compose up`. Fixed to match this repo's *own* root
	 * `tools/compose/base.compose.yaml`, which already mounts at
	 * `/var/lib/postgresql` correctly, this file just hadn't been kept in
	 * sync with that when postgres was bumped to 18 there.
	 *
	 * Third real, tested-live finding: this generated compose file never set
	 * `ORIGIN`, so `@orochibraru/svelte-smol` (this app's own server, an
	 * adapter-node-style build that requires `ORIGIN` for correct absolute-URL
	 * construction) silently fell back to `http://localhost:3000` regardless
	 * of the instance's real reachable address — verified live: the CLI's
	 * `homerun login` device flow printed
	 * "http://localhost:3000/cli-auth?code=..." as its approval link even
	 * when reached at a real IP, which would send a real remote user
	 * approving from their own machine to their own localhost instead of the
	 * actual server. Same class of gap as AUTH_SECRET/POSTGRES_PASSWORD :
	 * given an explicit, documented, overridable default here rather than an
	 * implicit one the operator doesn't know exists. Set it (in .env, next
	 * to AUTH_SECRET) to the real scheme+host once a domain is in use.
	 */
	#fullStackCompose(image: string, dockerSocket: string): string {
		return `# Generated by the Homerun installer (--mode=full). Every image below is
# pulled, not built, re-run \`docker compose -f compose.yaml pull && ...up -d\`
# here to update. Edit homerun.yaml next to this file for baseDomain/origin/etc,
# AUTH_SECRET is auto-generated into .env (steps/auth-secret.ts).
services:
  app:
    image: ${image}
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://\${POSTGRES_USER:-homerun}:\${POSTGRES_PASSWORD:-homerun}@postgres:5432/\${POSTGRES_DB:-homerun}
      AUTH_SECRET: "\${AUTH_SECRET:?missing from .env - the installer generates this automatically, set it yourself only if running this compose file standalone, e.g. openssl rand -hex 32}"
      ORIGIN: \${ORIGIN:-http://localhost:3000}
    ports:
      - "3000:3000"
    volumes:
      - ${dockerSocket}:${dockerSocket}
      - homerun-data:/app/data
      - ./homerun.yaml:/app/homerun.yaml:ro
    networks:
      - homerun
      - default

  traefik:
    image: traefik:v3
    restart: unless-stopped
    command:
      - --providers.docker=true
      - --providers.docker.exposedbydefault=false
      - --providers.docker.network=homerun
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.httpchallenge=true
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
      - --certificatesresolvers.letsencrypt.acme.email=\${ACME_EMAIL:-admin@example.com}
      - --certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ${dockerSocket}:${dockerSocket}:ro
      - traefik-certs:/letsencrypt
    networks:
      - homerun

  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_DB: \${POSTGRES_DB:-homerun}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-homerun}
      POSTGRES_USER: \${POSTGRES_USER:-homerun}
    volumes:
      - postgres-data:/var/lib/postgresql
    healthcheck:
      interval: 5s
      retries: 5
      test: ["CMD-SHELL", "pg_isready -U \${POSTGRES_USER:-homerun}"]
      timeout: 5s

networks:
  homerun:
    name: homerun
    external: true

volumes:
  postgres-data: {}
  traefik-certs: {}
  homerun-data: {}
`;
	}
}

export const FullStackInstaller = new FullStackInstallerService();
