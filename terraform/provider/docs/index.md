---
page_title: "Homerun Provider"
description:
  "Manages a Homerun instance: stacks, services and every setting the dashboard
  has."
---

# Homerun Provider

Manages a Homerun instance: stacks, services and every setting the dashboard
has.

It talks to the instance's REST API with an API key, so every resource needs the
key to hold the matching permission (write on Services for `homerun_service`, on
DNS for `homerun_dns_connection`, and so on). The provider is released with
every Homerun version, and the instance's **Infrastructure as Code** page
generates a ready-to-plan project, with an import block for everything that
already runs. See
[the Homerun documentation](https://github.com/orochibraru/homerun/blob/main/docs/infrastructure-as-code.md)
for the full guide.

## Example usage

```terraform
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

resource "homerun_stack" "example" {
  name        = "Media"
  slug        = "media"
  description = "Everything that serves the media library."
}
```

Set the API key in `HOMERUN_API_KEY` rather than in the configuration. Create
one under **Profile → API Keys**, with an expiry and only the permissions the
configuration needs.

## Schema

### Optional

- `api_key` (String, Sensitive) An API key (Profile → API Keys). Defaults to the
  `HOMERUN_API_KEY` environment variable.
- `endpoint` (String) The instance's URL, for example
  `https://homerun.example.com`. Defaults to the `HOMERUN_ENDPOINT` environment
  variable.
