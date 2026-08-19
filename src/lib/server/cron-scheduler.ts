import { ServiceDTO } from "$lib/dto/service-dto";
import { Logger } from "$lib/logger";
import { cronMatches } from "$lib/server/cron";
import { deployService } from "$lib/server/deploy";

const logger = new Logger("Cron");
const TICK_MS = 60_000;

// Survives Vite HMR the same way the db singleton does (db/lib.ts) —
// without this, every hot reload of a module in this import chain would
// start a second interval, double-firing redeploys.
const globalForCron = globalThis as unknown as {
  __cron_interval?: ReturnType<typeof setInterval>;
};

function sameMinute(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate() &&
    a.getHours() === b.getHours() &&
    a.getMinutes() === b.getMinutes()
  );
}

function isDueNow(svc: ServiceDTO, now: Date): boolean {
  const schedule = svc.cronSchedule;
  if (!(schedule && cronMatches(schedule, now))) {
    return false;
  }
  // Guards against a double-fire within the same due minute if the
  // interval ever jitters (e.g. two ticks landing 59s apart) — the cron
  // spec is minute-resolution, so "already ran this minute" is a
  // legitimate reason to skip, not just bookkeeping for the UI.
  return !(svc.cronLastRunAt && sameMinute(svc.cronLastRunAt, now));
}

async function fireCronRedeploy(svc: ServiceDTO, now: Date): Promise<void> {
  logger.info(
    `Cron redeploy triggered: service=${svc.id} schedule="${svc.cronSchedule}"`
  );
  await svc.update({ cronLastRunAt: now });

  // Fire-and-forget the actual deploy: one service's failure shouldn't
  // block the others, and the tick itself only needs to record intent.
  deployService(svc, svc.userId)
    .then((result) => {
      if (!result.success) {
        logger.error(`Cron redeploy failed: service=${svc.id}`, result.error);
      }
    })
    .catch((err) => {
      logger.error(`Cron redeploy threw: service=${svc.id}`, err);
    });
}

async function tick(): Promise<void> {
  const now = new Date();
  const due = (await ServiceDTO.listCronEnabled()).filter((svc) =>
    isDueNow(svc, now)
  );

  await Promise.all(due.map((svc) => fireCronRedeploy(svc, now)));
}

/** Starts the once-a-minute cron redeploy check. Idempotent — safe to call on every dev-server HMR reload. */
export function startCronScheduler(): void {
  if (globalForCron.__cron_interval) {
    return;
  }
  logger.info("Cron scheduler started (60s tick).");
  globalForCron.__cron_interval = setInterval(() => {
    tick().catch((err) => logger.error("Cron tick failed", err));
  }, TICK_MS);
}
