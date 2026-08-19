import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Logger } from "$lib/logger";
import { getDocker, type RemoteHostConnection } from "./client";

const logger = new Logger("GitBuild");
const execFileAsync = promisify(execFile);

export interface GitBuildParams {
  // Subdirectory inside the repo to use as the build context (".": repo root).
  buildContext?: string | null;
  // Relative to buildContext.
  dockerfilePath?: string | null;
  // Branch, tag, or commit — passed to `git clone --branch`, so only
  // branches/tags work directly (a bare commit SHA needs a full clone,
  // not attempted here — shallow-clone-by-ref covers the common case).
  gitRef?: string | null;
  gitUrl: string;
  remote?: RemoteHostConnection | null;
  tag: string;
}

export interface GitBuildResult {
  error?: string;
  success: boolean;
}

/**
 * Clones a git repo at a specific ref and builds its Dockerfile into a
 * local image, tagged `tag` — the deploy pipeline then runs that tag like
 * any other image, no registry involved. Shells out to the system `git`
 * binary (same "shell out to a well-known CLI tool" precedent as
 * `tar`/`df`/`nvidia-smi` elsewhere in this app) rather than a git
 * library dependency.
 */
export async function buildFromGit(
  params: GitBuildParams,
  onProgress?: (line: string) => void
): Promise<GitBuildResult> {
  const ref = params.gitRef || "main";
  const dir = await mkdtemp(join(tmpdir(), "localrun-build-"));

  try {
    onProgress?.(`Cloning ${params.gitUrl} (${ref})...`);
    await execFileAsync("git", [
      "clone",
      "--depth",
      "1",
      "--branch",
      ref,
      "--single-branch",
      params.gitUrl,
      dir,
    ]);
    logger.info(`Cloned: ${params.gitUrl}#${ref} -> ${dir}`);

    const contextDir = params.buildContext
      ? join(dir, params.buildContext)
      : dir;
    const dockerfile = params.dockerfilePath || "Dockerfile";

    onProgress?.(`Building ${dockerfile}...`);
    const docker = getDocker(params.remote);
    const stream = await docker.buildImage(
      { context: contextDir, src: ["."] },
      { dockerfile, rm: true, t: params.tag }
    );

    await new Promise<void>((resolve, reject) => {
      let lastStatus = "";
      docker.modem.followProgress(
        stream,
        (err: Error | null) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        },
        (event: { stream?: string; error?: string }) => {
          if (event.error) {
            reject(new Error(event.error));
            return;
          }
          const text = event.stream?.trim();
          // Docker build output is far chattier than a pull's layer
          // events — only forward lines that actually changed, same
          // "status change, not byte-tick" filtering as pullImage.
          if (text && text !== lastStatus) {
            lastStatus = text;
            onProgress?.(text);
          }
        }
      );
    });

    logger.info(`Build succeeded: tag=${params.tag}`);
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Build failed: ${params.gitUrl}#${ref}`, err);
    return { error: message, success: false };
  } finally {
    await rm(dir, { force: true, recursive: true }).catch(() => {
      // Best-effort cleanup — a leftover temp dir isn't worth failing the build over.
    });
  }
}
