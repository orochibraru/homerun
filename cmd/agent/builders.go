package main

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
)

// builderScript is the shell script that runs a build inside the helper
// container. It's generated from the main app's own builder-run.ts, and a
// unit test on each side pins both to it, so the two can't drift the way a
// hand-copied string would.
//
//go:embed builder.sh
var builderScript string

//go:embed builder-tools.json
var builderToolsJSON []byte

// BuilderChecksum is the sha256 of a tool's release archive and of the binary
// inside it.
type BuilderChecksum struct {
	Archive string `json:"archive"`
	Binary  string `json:"binary"`
}

// BuilderTools is everything the build runs with besides the script: the
// supported methods, the tool versions and their checksums.
type BuilderTools struct {
	BakeTargetPattern string                                `json:"bakeTargetPattern"`
	BuildMethods      []string                              `json:"buildMethods"`
	Checksums         map[string]map[string]BuilderChecksum `json:"checksums"`
	DefaultBakeFile   string                                `json:"defaultBakeFile"`
	DefaultBakeTarget string                                `json:"defaultBakeTarget"`
	HelperImage       string                                `json:"helperImage"`
	NixpacksVersion   string                                `json:"nixpacksVersion"`
	PackBuilders      map[string]string                     `json:"packBuilders"`
	PackVersion       string                                `json:"packVersion"`
	RailpackVersion   string                                `json:"railpackVersion"`
	ToolsVolume       string                                `json:"toolsVolume"`
}

// tools is builder-tools.json, parsed once at startup.
var tools = mustParseTools(builderToolsJSON)

// bakeTargetPattern is tools.BakeTargetPattern, compiled once.
var bakeTargetPattern = regexp.MustCompile(tools.BakeTargetPattern)

func mustParseTools(raw []byte) BuilderTools {
	var parsed BuilderTools
	if err := json.Unmarshal(raw, &parsed); err != nil {
		panic(fmt.Sprintf("builder-tools.json is invalid: %s", err))
	}
	return parsed
}

// isBuildMethod reports whether method is one the builder knows.
func isBuildMethod(method string) bool {
	return slices.Contains(tools.BuildMethods, method)
}

// CacheRegistry is the registry a build imports its BuildKit layer cache from
// and exports it to.
type CacheRegistry struct {
	Password    string
	RegistryURL string
	Username    string
}

// BuilderInput is what selects and configures a build.
type BuilderInput struct {
	BakeFile       string
	BakeTarget     string
	BuildContext   string
	CacheRegistry  *CacheRegistry
	DockerfilePath string
	Method         string
	RepoDir        string
	Tag            string
}

// builderBuildDir is the directory the builder is pointed at: the repository,
// or the build context inside it with surrounding slashes trimmed. A context
// that climbs out with ".." is refused.
func builderBuildDir(repoDir, buildContext string) (string, error) {
	trimmed := strings.Trim(strings.TrimSpace(buildContext), "/")
	if trimmed == "" || trimmed == "." {
		return repoDir, nil
	}
	if slices.Contains(strings.Split(trimmed, "/"), "..") {
		return "", fmt.Errorf("The build context can't leave the repository.")
	}
	return repoDir + "/" + trimmed, nil
}

// builderFilePath resolves a build definition file against the build
// directory, refusing one that resolves outside the repository.
func builderFilePath(repoDir, buildDir, file, fallback string) (string, error) {
	relative := strings.TrimLeft(strings.TrimSpace(file), "/")
	if relative == "" {
		relative = fallback
	}
	resolved := path.Clean(buildDir + "/" + relative)
	if !strings.HasPrefix(resolved, repoDir+"/") {
		return "", fmt.Errorf("The build file %s can't leave the repository.", relative)
	}
	return resolved, nil
}

// buildCacheRef is the registry ref a service's BuildKit layer cache lives at.
func buildCacheRef(registry CacheRegistry, tag string) string {
	return strings.TrimRight(registry.RegistryURL, "/") + "/" + strings.Split(tag, ":")[0] + ":buildcache"
}

// bakeTargetName is the bake target to build, the default when none is given.
// Anything but a plain target name is refused, since it reaches the shell.
func bakeTargetName(target string) (string, error) {
	name := strings.TrimSpace(target)
	if name == "" {
		name = tools.DefaultBakeTarget
	}
	if !bakeTargetPattern.MatchString(name) {
		return "", fmt.Errorf(
			"The bake target %s isn't valid, use letters, digits, dashes and underscores.", name,
		)
	}
	return name, nil
}

// builderEnv is the builder container's environment. User input only ever
// reaches the script as variables, never spliced into the script itself.
func builderEnv(input BuilderInput) ([]string, error) {
	buildDir, err := builderBuildDir(input.RepoDir, input.BuildContext)
	if err != nil {
		return nil, err
	}
	env := map[string]string{
		"BUILD_DIR":        buildDir,
		"BUILD_METHOD":     input.Method,
		"CACHE_PASSWORD":   "",
		"CACHE_REF":        "",
		"CACHE_REGISTRY":   "",
		"CACHE_USERNAME":   "",
		"IMAGE_TAG":        input.Tag,
		"NIXPACKS_VERSION": tools.NixpacksVersion,
		"PACK_VERSION":     tools.PackVersion,
		"PACK_VOLUME_KEY":  strings.Split(input.Tag, ":")[0],
		"RAILPACK_VERSION": tools.RailpackVersion,
	}
	if cache := input.CacheRegistry; cache != nil {
		env["CACHE_PASSWORD"] = cache.Password
		env["CACHE_REF"] = buildCacheRef(*cache, input.Tag)
		env["CACHE_REGISTRY"] = cache.RegistryURL
		env["CACHE_USERNAME"] = cache.Username
	}
	switch input.Method {
	case "dockerfile":
		file, err := builderFilePath(input.RepoDir, buildDir, input.DockerfilePath, "Dockerfile")
		if err != nil {
			return nil, err
		}
		env["BUILD_FILE"] = file
	case "bake":
		file, err := builderFilePath(input.RepoDir, buildDir, input.BakeFile, tools.DefaultBakeFile)
		if err != nil {
			return nil, err
		}
		target, err := bakeTargetName(input.BakeTarget)
		if err != nil {
			return nil, err
		}
		env["BUILD_FILE"] = file
		env["BAKE_TARGET"] = target
	case "heroku", "paketo":
		env["PACK_BUILDER"] = tools.PackBuilders[input.Method]
	}
	return orderedEnv(env), nil
}

// envOrder is the order builderEnv's variables are emitted in, matching the
// main app's own builderEnv so both produce byte-identical container configs.
var envOrder = []string{
	"BUILD_DIR", "BUILD_METHOD", "CACHE_PASSWORD", "CACHE_REF", "CACHE_REGISTRY",
	"CACHE_USERNAME", "IMAGE_TAG", "NIXPACKS_VERSION", "PACK_VERSION",
	"PACK_VOLUME_KEY", "RAILPACK_VERSION", "BUILD_FILE", "BAKE_TARGET", "PACK_BUILDER",
}

func orderedEnv(env map[string]string) []string {
	ordered := make([]string, 0, len(env))
	for _, key := range envOrder {
		if value, ok := env[key]; ok {
			ordered = append(ordered, key+"="+value)
		}
	}
	return ordered
}

var (
	uppercaseError = regexp.MustCompile(`\bERROR\b`)
	anyError       = regexp.MustCompile(`(?i)error`)
)

// buildFailureMessage is a failed build's error with its most telling output
// line: the last line shouting ERROR, else the last mentioning an error, else
// the last line at all.
func buildFailureMessage(method string, exitCode int, recentLines []string) string {
	lines := make([]string, 0, len(recentLines))
	for _, line := range recentLines {
		if trimmed := strings.TrimSpace(line); trimmed != "" {
			lines = append(lines, trimmed)
		}
	}
	cause := lastMatching(lines, uppercaseError)
	if cause == "" {
		cause = lastMatching(lines, anyError)
	}
	if cause == "" && len(lines) > 0 {
		cause = lines[len(lines)-1]
	}
	summary := fmt.Sprintf("The %s build failed (exit code %d)", method, exitCode)
	if cause == "" {
		return summary + "."
	}
	return summary + ": " + truncateRunes(cause, 1000)
}

func lastMatching(lines []string, pattern *regexp.Regexp) string {
	for index := len(lines) - 1; index >= 0; index-- {
		if pattern.MatchString(lines[index]) {
			return lines[index]
		}
	}
	return ""
}

// truncateRunes cuts s to at most n UTF-16-ish characters the way JavaScript's
// slice does for the ASCII build output this sees, without splitting a rune.
func truncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}
