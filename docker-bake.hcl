variable "TAG" {
  default = "latest"
}

group "default" {
  targets = ["app", "agent", "docs"]
}

group "ci" {
  targets = ["app-ci", "agent-ci", "docs-ci"]
}

target "base" {
  context    = "."
  dockerfile = "./Dockerfile"
  args = {
    APP_VERSION = "${TAG}"
  }
}

target "ci-base" {
  inherits = [ "base" ]
  platforms = [
    "linux/amd64",
    "linux/arm64"
  ]
}

target "app-base" {
  target = "app"
  tags       = ["orochibraru/homerun:latest", "orochibraru/homerun:${TAG}"]
  cache-from = ["type=gha,scope=app"]
  cache-to   = ["type=gha,mode=max,scope=app"]
}

target "agent-base" {
  target = "agent"
  tags       = ["orochibraru/homerun-agent:latest", "orochibraru/homerun-agent:${TAG}"]
  cache-from = ["type=gha,scope=agent"]
  cache-to   = ["type=gha,mode=max,scope=agent"]
}

target "docs-base" {
  target = "docs"
  tags       = ["orochibraru/homerun-docs:latest", "orochibraru/homerun-docs:${TAG}"]
  cache-from = ["type=gha,scope=docs"]
  cache-to   = ["type=gha,mode=max,scope=docs"]
}

target "app" {
  inherits   = ["base", "app-base"]
}

target "agent" {
  inherits   = ["base", "agent-base"]
}

target "docs" {
  inherits   = ["base", "docs-base"]
}

target "app-ci" {
  inherits   = ["ci-base", "app-base"]
}

target "agent-ci" {
  inherits   = ["ci-base", "agent-base"]
}

target "docs-ci" {
  inherits   = ["ci-base", "docs-base"]
}
