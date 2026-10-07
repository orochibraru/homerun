---
page_title: "homerun_git_provider (Resource)"
description: "A git provider users connect their account to."
---

# homerun_git_provider (Resource)

A git provider users connect their account to.

## Example usage

```terraform
resource "homerun_git_provider" "example" {
  kind          = "gitea"
  name          = "gitea"
  base_url      = "https://git.example.com"
  client_id     = var.gitea_client_id
  client_secret = var.gitea_client_secret
}
```

## Schema

### Required

- `client_id` (String)
- `client_secret` (String, Sensitive) Write-only: the API never returns it, so
  Terraform can't detect a change made outside it.
- `kind` (String) gitlab, gitea or bitbucket. GitHub Apps are registered from
  the dashboard, then imported. Changing it replaces the resource.
- `name` (String)

### Optional

- `base_url` (String)
- `enabled` (Boolean) Defaults to `true`.

### Read-only

- `client_secret_set` (Boolean)
- `id` (String) The object's id.

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_git_provider.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_git_provider.example "<id>"
```
