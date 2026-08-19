import { findTraefikContainer } from "$lib/server/docker/core-services";

export const load = async () => {
  const traefik = await findTraefikContainer();
  return { traefik };
};
