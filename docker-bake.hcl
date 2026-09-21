variable "TAG" {
  default = "latest"
}

variable "HOMERUN_APP_VERSION" {
  default = ""
}

group "default" {
  targets = ["app", "worker"]
}

group "ci" {
  targets = ["app-ci", "worker-ci"]
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

target "worker-base" {
  target = "worker"
  tags       = ["docker.io/orochibraru/homerun-worker:latest", "docker.io/orochibraru/homerun-worker:${TAG}"]
  cache-from = ["type=gha,scope=worker"]
  cache-to   = ["type=gha,mode=max,scope=worker"]
}

target "app" {
  inherits   = ["base", "app-base"]
}

target "worker" {
  inherits   = ["base", "worker-base"]
  target     = "worker"
}

target "app-ci" {
  inherits   = ["ci-base", "app-base"]
}

target "worker-ci" {
  inherits   = ["ci-base", "worker-base"]
}
