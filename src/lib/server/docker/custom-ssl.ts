import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "$lib/config";
import { Logger } from "$lib/logger";
import { decryptSecret } from "./secrets";

const logger = new Logger("CustomSsl");

export interface CustomSslService {
  customDomain: string | null;
  customSslCertEnc: string | null;
  customSslKeyEnc: string | null;
  slug: string;
}

/**
 * Writes (or removes) a service's custom SSL cert/key as files, plus a
 * Traefik dynamic-config YAML file pointing at them, into
 * `config.traefik.dynamicConfigDir`. This is genuinely inert unless the
 * admin has configured that dir *and* bind-mounted the same path into
 * the Traefik container with its file provider enabled (see
 * compose.yaml's commented-out example) — this app never touches the
 * Traefik container itself, only files on the host it's told to write
 * to. A no-op (logged once, not per-call) when dynamicConfigDir is unset.
 *
 * Traefik's file provider picks up the dynamic config on its own
 * (`--providers.file.watch=true`) — no restart needed, unlike the
 * Docker-provider labels used for everything else in this app.
 */
export async function syncCustomSslConfig(
  svc: CustomSslService
): Promise<void> {
  const dir = config.traefik.dynamicConfigDir;
  if (!dir) {
    return;
  }

  const configPath = join(dir, `${svc.slug}-tls.yml`);
  const certPath = join(dir, "certs", `${svc.slug}.crt`);
  const keyPath = join(dir, "certs", `${svc.slug}.key`);

  const hasCert = !!(
    svc.customDomain &&
    svc.customSslCertEnc &&
    svc.customSslKeyEnc
  );

  if (!hasCert) {
    // Not (or no longer) configured — remove any previously-written
    // files rather than leaving a stale cert Traefik might still be
    // serving for a domain that's since changed.
    await Promise.all([
      rm(configPath, { force: true }),
      rm(certPath, { force: true }),
      rm(keyPath, { force: true }),
    ]).catch((err) => {
      logger.warn(
        `Couldn't clean up dynamic TLS config: service=${svc.slug}`,
        err
      );
    });
    return;
  }

  const cert = svc.customSslCertEnc
    ? decryptSecret(svc.customSslCertEnc)
    : null;
  const key = svc.customSslKeyEnc ? decryptSecret(svc.customSslKeyEnc) : null;
  if (!(cert && key)) {
    logger.warn(`Couldn't decrypt custom SSL cert/key: service=${svc.slug}`);
    return;
  }

  try {
    await mkdir(join(dir, "certs"), { recursive: true });
    await Promise.all([writeFile(certPath, cert), writeFile(keyPath, key)]);
    await writeFile(
      configPath,
      `# Written by Homerun for service "${svc.slug}" — do not edit by hand.\ntls:\n  certificates:\n    - certFile: ${certPath}\n      keyFile: ${keyPath}\n`
    );
    logger.info(
      `Wrote dynamic TLS config: service=${svc.slug} domain=${svc.customDomain}`
    );
  } catch (err) {
    logger.error(
      `Failed to write dynamic TLS config: service=${svc.slug}`,
      err
    );
  }
}
