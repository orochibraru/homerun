<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

- [ ] One bun unit test failed once in the stop hook's `bun run test` (1619
      pass, 1 fail) and not in 22 reruns since. The gate now prints `(fail)`
      lines and below-threshold coverage rows first, so the next failure names
      it: fix that test then.
- [ ] Send an alert to notification channels (optionally, set in the channel's
      settings) to inform on blocked IPs

## Medium

## Large

- [ ] **OpenTelemetry traces in a service's Observability tab.** Run an
      OpenTelemetry collector Homerun manages (like the registry or the built-in
      object store) that services send OTLP traces to, over gRPC and HTTP on the
      shared network, with the endpoint injected as
      `OTEL_EXPORTER_OTLP_ENDPOINT` when a service opts in. Store spans with a
      retention setting, and add a Traces section under a service's
      Observability: a searchable trace list (duration, status, root span) and a
      waterfall view per trace, linked from error tracking events that carry a
      trace id. Instrument Homerun's own Go worker too: a span per job and per
      stage (pull, build, scan, deploy, backup), so a failed job's trace shows
      where it broke and how long each stage took, viewed in the instance's own
      observability page.

- [ ] **Homerun as infrastructure as code (after the S3 service).** A Terraform
      provider and a Pulumi provider (a bridged Terraform one, or native) that
      scaffold everything the dashboard can: stacks, services and their
      dependencies, databases from templates, and every service setting (source,
      build, environment variables, limits, networking and domains, volumes,
      healthcheck, runtime, revisions and rollback, previews, release channels,
      environments, login wall, cron), plus instance-level objects (DNS
      providers, git providers, notification channels, backup destinations,
      redirects). Needs the REST API to cover every one of those settings first
      (an audit of what `/api/v1` and the OpenAPI document are missing), stable
      ids, and import of existing resources. A dedicated IaC page in the
      dashboard: generate a starter configuration from what's running, point at
      the state bucket, show drift between the state and the instance.

- [ ] **Simple and advanced UI modes (once S3 and IaC land).** Two ways to run
      the dashboard, switchable per instance or per account. **Simple** is for
      homelab enthusiasts: self-hosting through click-ops, a short sidebar,
      templates and one-click deploys up front, sensible defaults and the
      engineering settings out of sight. **Advanced** shows the full cloud
      feature set for engineering work: environments, release channels,
      previews, IaC and state, S3, build servers, revisions, observability in
      depth. Decide what each mode hides (routes, tabs, sections, settings)
      without forking pages: a feature hidden in simple mode keeps working, it
      just isn't in the way.
