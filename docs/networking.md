# Networking

Everything on this tab is written onto the container as Traefik labels at
**create** time, so saving a change here doesn't affect the container that's
already running. Once a service has been deployed, the tab shows a **Redeploy**
button for exactly that reason, use it after changing a custom domain or
DNS-resolvability. The per-app login wall lives on the
[Security tab](login-wall.md).

- **Container port, protocol, network mode**, `bridge` (default, joins the
  shared `homerun` plus the service's stack network if any) or `host` (shares
  the host's network namespace directly, for apps needing real host-network
  access like mDNS/SSDP discovery). Homerun never publishes/maps a host port
  either way; a bridge-mode service is reachable only via its Traefik subdomain,
  a host-mode service only directly on the host's own port.
- **DNS-resolvable**, whether Traefik gets discovery labels at all. Forced off
  automatically in host mode (there's no per-container IP for Traefik's Docker
  provider to route to).
- **Custom domain**, an optional second hostname (in addition to the automatic
  `<slug>.<baseDomain>` one), routed to the same backend.

## Custom domains & SSL

A custom domain outside your instance's own base domain can't use Traefik's
automatic ACME resolver, so the Networking tab's SSL section lets you paste your
own cert/key PEM (encrypted at rest, same scheme as registry credentials). It
works out of the box: `compose.prod.yaml` and the installer's stack share a
`traefik-dynamic` volume between Homerun and Traefik, turn on Traefik's file
provider over it, and set `TRAEFIK_DYNAMIC_CONFIG_DIR` (see
[Configuration](configuration.md)) so Homerun knows where to write. Saving a
cert writes the cert, key and a dynamic-config file into that directory, and
Traefik's file provider picks them up on its own (no restart per certificate).
An instance started from an older compose file without that volume and those
flags has to add them once; until then, saving a cert does nothing.
