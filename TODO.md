<!-- vale off -->

# TODO

The backlog, and the only one. There is no priority ordering, pick whatever.
When done delete the entry, no bloat.

## Small

## Medium

## Large

- [ ] Pulumi projects: generate a Pulumi program
      (`new homerun.X(..., { import })`) from the inventory like the HCL
      generator, and a drift check reading Pulumi's checkpoint from the bucket

- [ ] Package registries: run language package registries (npm first, then PyPI,
      Maven, Cargo...) from Homerun as core services like the Docker registry,
      with tokens and an optional public hostname, listed under Registries in
      the sidebar next to Docker Registry

- [ ] CI pipelines tab: pull GitHub Actions, GitLab CI and Gitea Actions runs
      for a git-built service's repo (through its existing git provider
      connection) into a Pipelines tab: runs list, success rate, duration
      p50/p95, queue time, and accumulated cost (billable minutes × a
      per-runner-label rate, self-hosted runners at 0 or an operator rate). Each
      run lands as a trace in `trace_span` (run → job → step spans) so the
      existing trace view renders it: the bundled collector gets the contrib
      `github` and `gitlab` receivers fed by a provider webhook Homerun
      registers, and Gitea (no receiver) is converted to OTLP spans by Homerun's
      own webhook handler from the run/job API
