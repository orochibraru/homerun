package agent

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"path"
	"regexp"
	"slices"
	"strings"
)

// BuilderScript is the shell script that runs a build inside the helper
// container, shared by the agent and the homerun worker.
//
//go:embed builder.sh
var BuilderScript string

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

// Tools is builder-tools.json, parsed once at startup.
var Tools = MustParseTools(builderToolsJSON)

// bakeTargetPattern is tools.BakeTargetPattern, compiled once.
var bakeTargetPattern = regexp.MustCompile(Tools.BakeTargetPattern)

// MustParseTools parses builder-tools.json, panicking on invalid data since a
// broken embed should stop the agent at startup, not at build time.
func MustParseTools(raw []byte) BuilderTools {
	var parsed BuilderTools
	if err := json.Unmarshal(raw, &parsed); err != nil {
		panic(fmt.Sprintf("builder-tools.json is invalid: %s", err))
	}
	return parsed
}

// IsBuildMethod reports whether method is one the builder knows.
func IsBuildMethod(method string) bool {
	return slices.Contains(Tools.BuildMethods, method)
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

// BuilderBuildDir is the directory the builder is pointed at: the repository,
// or the build context inside it with surrounding slashes trimmed. A context
// that climbs out with ".." is refused.
func BuilderBuildDir(repoDir, buildContext string) (string, error) {
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

// BuildCacheRef is the registry ref a service's BuildKit layer cache lives at.
func BuildCacheRef(registry CacheRegistry, tag string) string {
	return strings.TrimRight(registry.RegistryURL, "/") + "/" + strings.Split(tag, ":")[0] + ":buildcache"
}

// BakeTargetName is the bake target to build, the default when none is given.
// Anything but a plain target name is refused, since it reaches the shell.
func BakeTargetName(target string) (string, error) {
	name := strings.TrimSpace(target)
	if name == "" {
		name = Tools.DefaultBakeTarget
	}
	if !bakeTargetPattern.MatchString(name) {
		return "", fmt.Errorf(
			"The bake target %s isn't valid, use letters, digits, dashes and underscores.", name,
		)
	}
	return name, nil
}

// BuilderEnv is the builder container's environment. User input only ever
// reaches the script as variables, never spliced into the script itself.
func BuilderEnv(input BuilderInput) ([]string, error) {
	buildDir, err := BuilderBuildDir(input.RepoDir, input.BuildContext)
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
		"NIXPACKS_VERSION": Tools.NixpacksVersion,
		"PACK_VERSION":     Tools.PackVersion,
		"PACK_VOLUME_KEY":  strings.Split(input.Tag, ":")[0],
		"RAILPACK_VERSION": Tools.RailpackVersion,
	}
	if cache := input.CacheRegistry; cache != nil {
		env["CACHE_PASSWORD"] = cache.Password
		env["CACHE_REF"] = BuildCacheRef(*cache, input.Tag)
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
		file, err := builderFilePath(input.RepoDir, buildDir, input.BakeFile, Tools.DefaultBakeFile)
		if err != nil {
			return nil, err
		}
		target, err := BakeTargetName(input.BakeTarget)
		if err != nil {
			return nil, err
		}
		env["BUILD_FILE"] = file
		env["BAKE_TARGET"] = target
	case "heroku", "paketo":
		env["PACK_BUILDER"] = Tools.PackBuilders[input.Method]
	}
	return orderedEnv(env), nil
}

// envOrder is the order BuilderEnv's variables are emitted in, matching the
// main app's own builderEnv so both produce byte-identical container configs.
var envOrder = []string{
	"BUILD_DIR", "BUILD_METHOD", "CACHE_PASSWORD", "CACHE_REF", "CACHE_REGISTRY",
	"CACHE_USERNAME", "IMAGE_TAG", "NIXPACKS_VERSION", "PACK_VERSION",
	"PACK_VOLUME_KEY", "RAILPACK_VERSION", "BUILD_FILE", "BAKE_TARGET", "PACK_BUILDER",
}

// orderedEnv renders env as KEY=value strings in envOrder.
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

// BuildFailureMessage is a failed build's error with its most telling output
// line: the last line shouting ERROR, else the last mentioning an error, else
// the last line at all.
func BuildFailureMessage(method string, exitCode int, recentLines []string) string {
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
	return summary + ": " + TruncateRunes(cause, 1000)
}

// lastMatching returns the last line matching pattern, or "" when none do.
func lastMatching(lines []string, pattern *regexp.Regexp) string {
	for index := len(lines) - 1; index >= 0; index-- {
		if pattern.MatchString(lines[index]) {
			return lines[index]
		}
	}
	return ""
}

// TruncateRunes cuts s to at most n UTF-16-ish characters the way JavaScript's
// slice does for the ASCII build output this sees, without splitting a rune.
func TruncateRunes(s string, n int) string {
	runes := []rune(s)
	if len(runes) <= n {
		return s
	}
	return string(runes[:n])
}
