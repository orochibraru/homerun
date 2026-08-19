import { runSetupChecks } from "$lib/server/setup-checks";

export const load = async () => {
  const checks = await runSetupChecks();
  return { checks };
};
