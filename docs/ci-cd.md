# Deploying from CI

[Deploy on push](deploy-on-push.md) covers a service Homerun builds from git.
When your CI builds and pushes the image itself (tests first, a registry of your
own, a monorepo that builds several images), let the pipeline tell Homerun when
to deploy instead: a GitHub Action, a Docker image for GitLab or any other CI,
or one API call.

Every option does the same thing: it deploys the service and **waits for the
deploy to finish**, exiting non-zero when it fails, so a broken deploy fails the
pipeline. Pass a **tag** to switch the service to the image you just pushed
(`ghcr.io/you/app:3f9c2e1`) before deploying. The tag is saved on the service,
so later deploys and restarts keep it; leave it out to redeploy the current tag.
A tag only applies to image-based services: a service Homerun builds from git
answers 400.

## What you need

- **An API key** with **Full access**, from your profile's
  [API keys](your-profile.md#api-keys). A read-only key can't deploy. Store it
  as a CI secret, never in the repository.
- **The service's id**: `homerun services list`, or the last part of the
  service's URL in the dashboard (`/services/<id>`).
- **Your instance's URL**, e.g. `https://homerun.example.com`, reachable from
  the CI runner. A dashboard only on your LAN needs a self-hosted runner there.

The deploy request stays open until the deploy finishes, which for a large image
can take minutes; a proxy in front of Homerun needs a timeout long enough for
that.

## GitHub Actions

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      # ...build and push ghcr.io/you/app:${{ github.sha }} first...
      - uses: orochibraru/homerun@v1.0.49
        with:
          base-url: https://homerun.example.com
          api-key: ${{ secrets.HOMERUN_API_KEY }}
          service: 7b1e0c2a-4f7d-4c1e-9a55-2f0d3c8e6b41
          tag: ${{ github.sha }}
```

| Input         | Required | What it does                                                                               |
| ------------- | -------- | ------------------------------------------------------------------------------------------ |
| `base-url`    | yes      | Your instance's URL.                                                                       |
| `api-key`     | yes      | A full-access API key.                                                                     |
| `service`     | yes      | The service's id.                                                                          |
| `tag`         | no       | Image tag to switch to before deploying. Empty redeploys the current tag.                  |
| `cli-version` | no       | CLI release to use, e.g. `v1.0.49`. Defaults to the action's own tag, else the latest one. |

The action installs the CLI release matching its tag and runs
`homerun services deploy`. Its `deployment-id` output is the id of the
deployment it created, shown on the service's Revisions tab. It runs on Linux
and macOS runners, not Windows. Pin a release tag rather than `main`, so an
upgrade of your instance and of your pipelines happen when you choose.

## GitLab CI and other CIs: the Docker image

`orochibraru/homerun-cli` is the CLI on Alpine, with a shell and nothing else.
It reads its instance and key from `HOMERUN_BASE_URL` and `HOMERUN_API_KEY`, so
there's no login step:

```yaml
deploy:
  stage: deploy
  image: orochibraru/homerun-cli:v1.0.49
  variables:
    HOMERUN_BASE_URL: https://homerun.example.com
    # HOMERUN_API_KEY: a masked CI/CD variable set in the project settings
  script:
    - homerun services deploy 7b1e0c2a-4f7d-4c1e-9a55-2f0d3c8e6b41 --tag
      "$CI_COMMIT_SHORT_SHA"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
```

The image has no entrypoint, so GitLab's `script:` runs as written. The same
image works in Woodpecker, Drone, Forgejo Actions or anything else that runs a
container: `homerun services deploy <id> [--tag <tag>]` is the whole command,
and it prints the deploy's result as JSON.

## Without the CLI

The CLI is a thin wrapper around one request:

```bash
curl -fsS -X POST "https://homerun.example.com/api/v1/services/<id>/deploy" \
  -H "Authorization: Bearer $HOMERUN_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"tag": "3f9c2e1"}'
```

It answers `200` with
`{"success": true, "deploymentId": ..., "containerId": ...}` once the service is
up, `500` with `{"deploymentId": ..., "error": ...}` when the deploy failed,
`400` for a malformed tag or a tag on a git-built service. The body is optional:
an empty POST redeploys the current tag. See [API & CLI](api-and-cli.md) for the
rest of the API.
