# Infrastructure as code

Homerun can be managed with Terraform (or OpenTofu) and Pulumi: stacks, services
and every setting the dashboard has, plus the objects around them. The
**Infrastructure as Code** page (Integrations, admins only) writes a starter
configuration from what's already running, and compares a Terraform state with
the instance to show what changed outside it.

## The Terraform provider

The provider's address is `orochibraru/homerun`. It talks to the REST API, so it
can do what an API key can (see [API & CLI](api-and-cli.md)), and it needs an
admin key for the admin-only resources (DNS connections, git providers, object
stores and buckets).

```hcl
terraform {
  required_providers {
    homerun = {
      source = "orochibraru/homerun"
    }
  }
}

provider "homerun" {
  endpoint = "https://homerun.example.com"
}
```

`endpoint` and `api_key` fall back to the `HOMERUN_ENDPOINT` and
`HOMERUN_API_KEY` environment variables.

### Resources

| Resource                       | What it manages                                                                                                                                                                           |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `homerun_stack`                | A stack, nested in another with `parent_id`.                                                                                                                                              |
| `homerun_service`              | A service with every setting: source and build, registry, env vars, compute, networking and domains, published ports, runtime, healthcheck, login wall, previews, release channels, cron. |
| `homerun_service_environment`  | An environment of a service (staging, demo and so on).                                                                                                                                    |
| `homerun_service_dependency`   | One service depending on another.                                                                                                                                                         |
| `homerun_volume`               | A storage volume and its backup settings.                                                                                                                                                 |
| `homerun_volume_mount`         | A volume mounted into a service.                                                                                                                                                          |
| `homerun_cron_job`             | A cron job.                                                                                                                                                                               |
| `homerun_redirect`             | A redirect.                                                                                                                                                                               |
| `homerun_notification_channel` | A notification channel of the API key's account.                                                                                                                                          |
| `homerun_backup_destination`   | A backup destination (S3, SFTP, SMB or WebDAV).                                                                                                                                           |
| `homerun_status_page`          | A status page.                                                                                                                                                                            |
| `homerun_dns_connection`       | A DNS provider account (`dns_provider` is its id, `credentials` its fields).                                                                                                              |
| `homerun_git_provider`         | A GitLab, Gitea or Bitbucket OAuth app. A GitHub App is registered from the dashboard, then imported.                                                                                     |
| `homerun_build_cache_registry` | A build cache registry.                                                                                                                                                                   |
| `homerun_object_store`         | An S3-compatible object store. The built-in store can be read but not changed.                                                                                                            |
| `homerun_bucket`               | A bucket on a store, with its object expiration.                                                                                                                                          |

The data sources `homerun_template`, `homerun_service` and `homerun_stack` read
an object by `id`, a template also by `name`, a service or a stack also by
`slug`.

How the attributes behave:

- **Left out means left alone.** An attribute missing from the configuration
  keeps whatever value the instance has, and removing one from the configuration
  doesn't reset it. Set it to change it.
- **Secrets are write-only.** Passwords, keys, a webhook target and DNS
  credentials are sent to Homerun but never read back, so a change made in the
  dashboard doesn't show in a plan. They're marked sensitive.
- **Values are stored the way Homerun stores them.** A domain is stored in
  lowercase and the destination of a redirect gets a trailing `/`: write them
  that way, or the next plan shows the difference.
- **`template_id`** creates the service from a template (its image, variables,
  volumes and linked services), then applies the other attributes on top. Linked
  services the template creates aren't managed by the configuration.
- **`deploy_on_change`** on a service or an environment deploys it after it's
  created and after every change, and waits for the deploy. A failed deploy is a
  warning: the settings are saved either way.
- **Import** by id: `terraform import homerun_service.web <id>`, or a Terraform
  1.5 `import` block. A bucket's id is `<store_id>/<name>`.

### Installing it

The provider isn't on the Terraform Registry. Build it from the repository
(`go build` in `terraform/provider`), or download the
`homerun-terraform-provider` binary for your platform from a release and name it
`terraform-provider-homerun`. Then point Terraform at it in `~/.terraformrc`:

```hcl
provider_installation {
  dev_overrides {
    "orochibraru/homerun" = "/home/you/.local/share/terraform-provider-homerun"
  }
  direct {}
}
```

With `dev_overrides`, `terraform init` doesn't download the provider and `plan`
and `apply` use the binary directly. To pin a version instead, put the binary in
a filesystem mirror:
`~/.terraform.d/plugins/registry.terraform.io/orochibraru/homerun/<version>/<os>_<arch>/terraform-provider-homerun_v<version>`.
The **Provider** tab of the Infrastructure as Code page has the same steps, with
your instance's URL filled in.

## Generating a configuration

The **Generate** tab writes a Terraform project for one stack or one service,
never the whole instance at once: a project per stack or service keeps each plan
small and each state independent. A stack covers itself, its substacks, their
services with their environments, dependencies, mounts and volumes, and the
status pages of those stacks. A service covers itself, its environments, the
dependencies it declares, and its mounts with their volumes; its stack and the
services it depends on stay outside, referenced by id. Pick a **State backend**
to add an `http` backend block pointing at one of your
[Terraform state projects](object-storage.md#terraform-state).

The project is a folder you download as a zip, and preview file by file on the
page, highlighted:

- `versions.tf`: the provider's source, and the backend when you picked one.
- `providers.tf`: the provider, pointed at this instance.
- One `service_<name>.tf` per service, with its environments, dependencies and
  volume mounts, each next to its `import` block.
- `stacks.tf` (stacks and status pages) and `volumes.tf`.
- `variables.tf` and `terraform.tfvars.example`, when there are secrets to fill
  in.
- A `README.md` with the steps below, and a `.gitignore` that keeps the state,
  `.terraform/` and `terraform.tfvars` out of git.

Values a setting leaves at its default are left out. References between objects
become Terraform references (`homerun_stack.apps.id`). Secrets the API never
returns, and env vars marked secret, become sensitive variables: copy
`terraform.tfvars.example` to `terraform.tfvars` and fill them in. Then:

```sh
export HOMERUN_API_KEY=<an API key>
export TF_HTTP_PASSWORD=$HOMERUN_API_KEY
terraform init
terraform plan
```

The first plan imports everything and updates the write-only secrets (Terraform
can't know their current value). Previews, canaries and the built-in object
store are Homerun's own and aren't included.

## Drift

The **Drift** tab reads the latest version of a Terraform state project and
compares every `homerun_*` resource in it with the live object, through the same
mapping the provider uses:

- **Drifted**: an attribute changed outside Terraform, with the value in the
  state and the live one. A sensitive attribute (env vars) only says it changed.
  `terraform plan` puts it back unless the configuration changes too.
- **Missing**: in the state, deleted on the instance. `terraform plan` creates
  it again.
- **Unmanaged**: running, with no resource in this state. The Generate tab
  writes its import block.

Write-only attributes can't be compared and are left out.

## Pulumi

Pulumi (3.147 or later) runs any Terraform provider, so there's no separate
Pulumi provider. Add it to a Pulumi project from the binary, which generates a
typed SDK and records it under `packages` in `Pulumi.yaml`:

```sh
pulumi package add terraform-provider /path/to/terraform-provider-homerun
pulumi config set homerun:endpoint https://homerun.example.com
pulumi config set --secret homerun:apiKey <an API key>
```

The configuration keys use camel case. Every `homerun_` resource is a class
(`homerun_service` is `Service`) with camel case attributes, and data sources
are `get` functions:

```ts
import * as homerun from "@pulumi/homerun";

const web = new homerun.Stack("web", { name: "Web", slug: "web" });

const postgres = homerun.getTemplateOutput({ name: "PostgreSQL" });
const db = new homerun.Service("db", {
  stackId: web.id,
  templateId: postgres.id,
  slug: "web-db",
});

new homerun.Service("api", {
  name: "API",
  slug: "api",
  stackId: web.id,
  image: "ghcr.io/acme/api",
  tag: "1.4.0",
  containerPort: 8080,
  envVars: { DATABASE_HOST: db.slug },
  deployOnChange: true,
});
```

Pulumi keeps its own state: the S3 login a Terraform state project shows works
for it too.
