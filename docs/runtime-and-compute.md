# Runtime and compute

How a service's container starts, what it can reach on the host, and how much
CPU and memory it gets.

## Runtime

The **Runtime** tab changes how the container starts and what it can reach on
the host, all applied on the next deploy:

- **Entrypoint** and **Command** replace the image's own, split the way a shell
  would (quote an argument with spaces). They aren't run through a shell: use
  `sh -c '...'` for pipes or variables. Leave blank to keep the image's.
- **Labels**, one `KEY=VALUE` per line, added to the container (and to the swarm
  service in swarm mode). Homerun's own tracking and Traefik labels win on a
  clash, so a custom label can add a Traefik middleware but can't break the
  service's route.
- **Added capabilities** (`NET_ADMIN, SYS_TIME`), **Devices**
  (`host[:container[:rwm]]`, like `docker run --device`) and **Run privileged**.
  Only an admin can set or change these three: they give the container access to
  the host, so other roles see them read-only, and the REST API and compose
  import refuse them with a 403. Only an admin can deploy a template that sets
  them either. Swarm services can't run privileged or map devices, so those two
  are ignored in [swarm mode](swarm-mode.md); capabilities, labels, command and
  entrypoint apply there too.

## Compute

CPU and memory limits on the Compute tab, applied as real Docker resource limits
on the next deploy. The same tab carries the replica count used by
[swarm mode](swarm-mode.md); it has no effect in standalone mode, where a
service is always one container.
