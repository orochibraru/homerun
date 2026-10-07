---
page_title: "homerun_service_environment (Resource)"
description:
  "An environment of a service (staging, demo...): a copy of it running another
  branch or tag."
---

# homerun_service_environment (Resource)

An environment of a service (staging, demo...): a copy of it running another
branch or tag.

## Example usage

```terraform
resource "homerun_service_environment" "example" {
  service_id = homerun_service.example.id
  name       = "staging"
  ref        = "develop"
  env_overrides = {
    LOG_LEVEL = "debug"
  }
}
```

## Schema

### Required

- `name` (String) Changing it replaces the resource.
- `ref` (String) Branch or tag (git) or image tag the environment runs.
- `service_id` (String) Changing it replaces the resource.

### Optional

- `deploy_on_change` (Boolean) Deploy after every create or change, and wait for
  the deploy to finish. Defaults to `false`.
- `domain` (String)
- `env_overrides` (Map of String, Sensitive) Variables set on top of the copied
  ones. Write-only: the API never returns it, so Terraform can't detect a change
  made outside it.

### Read-only

- `id` (String) The object's id.
- `slug` (String)

## Import

Import an existing object by its id, with an `import` block:

```terraform
import {
  to = homerun_service_environment.example
  id = "<id>"
}
```

or the command line:

```shell
terraform import homerun_service_environment.example "<id>"
```
