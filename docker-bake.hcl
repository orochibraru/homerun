variable "TAG" {
  default = "latest"
}

variable "HOMERUN_APP_VERSION" {
  default = ""
}

group "default" {
  targets = ["app", "agent"]
}

group "ci" {
  targets = ["app-ci", "agent-ci"]
}

target "base" {
  context    = "."
  dockerfile = "./Dockerfile"
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
  args       = { HOMERUN_APP_VERSION = HOMERUN_APP_VERSION }
  tags       = ["docker.io/orochibraru/homerun:latest", "docker.io/orochibraru/homerun:${TAG}"]
  cache-from = ["type=gha,scope=app"]
  cache-to   = ["type=gha,mode=max,scope=app"]
}

target "agent-base" {
  target = "agent"
  tags       = ["docker.io/orochibraru/homerun-agent:latest", "docker.io/orochibraru/homerun-agent:${TAG}"]
  cache-from = ["type=gha,scope=agent"]
  cache-to   = ["type=gha,mode=max,scope=agent"]
}

target "app" {
  inherits   = ["base", "app-base"]
}

target "agent" {
  inherits   = ["base", "agent-base"]
}

target "app-ci" {
  inherits   = ["ci-base", "app-base"]
}

target "agent-ci" {
  inherits   = ["ci-base", "agent-base"]
}
