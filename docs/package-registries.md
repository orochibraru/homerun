# Package registries

Advanced mode: [simple mode](ui-modes.md) hides the npm Registry and PyPI
Registry sidebar entries. A hidden page still opens from a link.

Next to the [Docker Registry](registry.md), Homerun runs two language package
registries as core containers, each under **Delivery → Registries** in the
sidebar (they need the Registry permission):

- **npm Registry** (`/package-registries/npm`):
  [Verdaccio](https://verdaccio.org). Packages you publish stay on this server;
  any other package is fetched from npmjs.org and cached, so it can be the only
  registry your `.npmrc` points at.
- **PyPI Registry** (`/package-registries/pypi`):
  [pypiserver](https://github.com/pypiserver/pypiserver). Packages you upload
  stay on this server; a package it doesn't hold is redirected to pypi.org, so
  it can be the only index `pip` uses.

Both are off until you turn them on, and each page has three tabs: **Overview**,
**Tokens** and **Settings**.

## Overview

Whether the container is running, its public address once it's published, its
address on the Homerun network (`http://homerun-npm:4873/`,
`http://homerun-pypi:8080/`) and how many tokens it has. Below that, the client
configuration to copy, pointing at the public address when there is one and at
the internal address otherwise:

- npm: an `.npmrc` (`registry=` plus the registry's `_auth` line) and the
  `npm publish --registry` command.
- PyPI: a `pip.conf` whose `index-url` carries the token, and the
  `twine upload --repository-url` command.

Here the token is a placeholder; the page you create a token on shows the same
snippets with it filled in.

Until a registry is published at a hostname, only containers on the Homerun
network (standalone services) reach it, by its internal address. Swarm services,
image builds and other machines need the public hostname.

## Tokens

**Every request needs a token**, installs and listings included: neither
registry has an anonymous mode here, so publishing one never exposes an open
registry. **New token** asks for a username (3 to 32 lowercase letters, digits,
dashes or underscores, unique per registry) and generates the secret, **shown
exactly once** with the ready-to-paste snippets: it's stored only as a bcrypt
hash, so save it before you leave the page.

A token can both install and publish. Hand out one per person or CI job and
revoke the ones you're done with. Creating or revoking a token rewrites the
registry's htpasswd file, which both registries reread on the next request, so
it takes effect straight away without a restart.

For npm, the `_auth` value is the base64 of `username:token`
(`echo -n 'ci:<token>' | base64`), on the line for the registry's host in
`.npmrc`. For pip and twine, the username and token are the Basic credentials.

## Settings

- **Run the npm Registry / PyPI Registry**: starts the registry's container on
  the Homerun network, with its packages in a volume of their own
  (`homerun-npm-data`, `homerun-pypi-data`) and its config and htpasswd in
  another (`homerun-npm-config`, `homerun-pypi-config`). Turning it off removes
  the container and keeps both volumes, so turning it back on finds every
  package where it was.
- **Public hostname**: routes the registry through Traefik at a hostname of your
  own, over HTTPS, so other machines can install from and publish to it. Saving
  it also creates its DNS record (or Pangolin resource, with Pangolin's sign-in
  off, since npm and pip can't follow it) at the configured DNS provider, and
  removes the previous one. A hostname another service, redirect or core service
  already routes is refused. Leave it empty to keep the registry internal.

**Save** runs in the background through the
[job queue](scheduling.md#the-job-queue), since it can create or recreate the
registry's container: the notice that it started has a **View task** button that
opens the job and its log. When the worker restarts, Homerun re-asserts every
registry that's on, the same way it does the Docker registry.

## Not built

Maven and Cargo registries. The maintained images for them (Reposilite, Kellnr)
keep their own users and tokens in their own databases instead of an htpasswd
file, so they don't fit the model above without a second auth path. There's no
REST API, CLI or Terraform resource for the package registries yet; they're
managed from these pages.
