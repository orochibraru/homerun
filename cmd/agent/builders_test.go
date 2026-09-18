package main

import (
	"encoding/json"
	"os"
	"strings"
	"testing"
)

type envCase struct {
	Env   []string `json:"env"`
	Input struct {
		BakeFile      *string `json:"bakeFile"`
		BakeTarget    *string `json:"bakeTarget"`
		BuildContext  *string `json:"buildContext"`
		CacheRegistry *struct {
			Password    string `json:"password"`
			RegistryURL string `json:"registryUrl"`
			Username    string `json:"username"`
		} `json:"cacheRegistry"`
		DockerfilePath *string `json:"dockerfilePath"`
		Method         string  `json:"method"`
		RepoDir        string  `json:"repoDir"`
		Tag            string  `json:"tag"`
	} `json:"input"`
	Error *string `json:"error"`
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (c envCase) builderInput() BuilderInput {
	input := BuilderInput{
		BakeFile:       deref(c.Input.BakeFile),
		BakeTarget:     deref(c.Input.BakeTarget),
		BuildContext:   deref(c.Input.BuildContext),
		DockerfilePath: deref(c.Input.DockerfilePath),
		Method:         c.Input.Method,
		RepoDir:        c.Input.RepoDir,
		Tag:            c.Input.Tag,
	}
	if cache := c.Input.CacheRegistry; cache != nil {
		input.CacheRegistry = &CacheRegistry{
			Password: cache.Password, RegistryURL: cache.RegistryURL, Username: cache.Username,
		}
	}
	return input
}

func loadFixture(t *testing.T, path string, into any) {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	if err := json.Unmarshal(raw, into); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}
}

// TestBuilderEnvMatchesTheMainApp pins the Go builderEnv to the output of the
// main app's own TypeScript builderEnv, recorded in testdata. The TS side has a
// test pinning itself to the same file, which is what keeps the two
// implementations from drifting now that neither can import the other.
func TestBuilderEnvMatchesTheMainApp(t *testing.T) {
	var fixture struct {
		Cases  []envCase `json:"cases"`
		Errors []envCase `json:"errors"`
	}
	loadFixture(t, "testdata/builder-env.json", &fixture)
	if len(fixture.Cases) == 0 || len(fixture.Errors) == 0 {
		t.Fatal("the fixture should carry both working and refused inputs")
	}

	for index, testCase := range fixture.Cases {
		got, err := builderEnv(testCase.builderInput())
		if err != nil {
			t.Errorf("case %d (%s): unexpected error %v", index, testCase.Input.Method, err)
			continue
		}
		if strings.Join(got, "\n") != strings.Join(testCase.Env, "\n") {
			t.Errorf("case %d (%s): env differs from the main app's\n want %v\n  got %v",
				index, testCase.Input.Method, testCase.Env, got)
		}
	}

	for index, testCase := range fixture.Errors {
		_, err := builderEnv(testCase.builderInput())
		if testCase.Error == nil {
			if err != nil {
				t.Errorf("error case %d: the main app accepts this, got %v", index, err)
			}
			continue
		}
		if err == nil || err.Error() != *testCase.Error {
			t.Errorf("error case %d: want %q, got %v", index, *testCase.Error, err)
		}
	}
}

func TestBuildFailureMessageMatchesTheMainApp(t *testing.T) {
	var cases []struct {
		ExitCode int      `json:"exitCode"`
		Lines    []string `json:"lines"`
		Message  string   `json:"message"`
		Method   string   `json:"method"`
	}
	loadFixture(t, "testdata/build-failure.json", &cases)
	for index, testCase := range cases {
		if got := buildFailureMessage(testCase.Method, testCase.ExitCode, testCase.Lines); got != testCase.Message {
			t.Errorf("case %d: want %q\n  got %q", index, testCase.Message, got)
		}
	}
}

func TestBuilderToolsAreEmbedded(t *testing.T) {
	if !strings.HasPrefix(builderScript, "set -eu\n") {
		t.Error("the builder script should be embedded verbatim")
	}
	for _, method := range []string{"dockerfile", "bake", "nixpacks", "railpack", "heroku", "paketo"} {
		if !isBuildMethod(method) {
			t.Errorf("%s should be a known build method", method)
		}
		if !strings.Contains(builderScript, method) {
			t.Errorf("the script should handle %s", method)
		}
	}
	if isBuildMethod("docker-compose") {
		t.Error("an unknown method must be refused")
	}
	for _, tool := range []string{"nixpacks", "pack", "railpack"} {
		for _, arch := range []string{"amd64", "arm64"} {
			checksum := tools.Checksums[tool][arch]
			if len(checksum.Archive) != 64 || len(checksum.Binary) != 64 {
				t.Errorf("%s/%s should carry both sha256 checksums, got %+v", tool, arch, checksum)
			}
			if !strings.Contains(builderScript, checksum.Archive) {
				t.Errorf("%s/%s's archive checksum should be baked into the script", tool, arch)
			}
		}
	}
	if tools.HelperImage == "" || tools.ToolsVolume == "" {
		t.Errorf("the helper image and tools volume must be set, got %+v", tools)
	}
}

func TestMustParseToolsRefusesBrokenData(t *testing.T) {
	defer func() {
		if recover() == nil {
			t.Error("broken builder-tools.json should stop the agent at startup, not at build time")
		}
	}()
	mustParseTools([]byte("{nope"))
}

func TestBuilderBuildDir(t *testing.T) {
	cases := []struct {
		context string
		want    string
		wantErr bool
	}{
		{"", "/r", false},
		{".", "/r", false},
		{"  /apps/web/  ", "/r/apps/web", false},
		{"../escape", "", true},
		{"a/../../b", "", true},
	}
	for _, testCase := range cases {
		got, err := builderBuildDir("/r", testCase.context)
		if testCase.wantErr {
			if err == nil {
				t.Errorf("%q should be refused", testCase.context)
			}
			continue
		}
		if err != nil || got != testCase.want {
			t.Errorf("%q: want %q, got %q %v", testCase.context, testCase.want, got, err)
		}
	}
}

func TestBuildCacheRef(t *testing.T) {
	got := buildCacheRef(CacheRegistry{RegistryURL: "registry.example.com/"}, "svc:abc")
	if got != "registry.example.com/svc:buildcache" {
		t.Errorf("got %q", got)
	}
}

func TestBakeTargetName(t *testing.T) {
	if name, err := bakeTargetName(""); err != nil || name != "default" {
		t.Errorf("an empty target is the default one, got %q %v", name, err)
	}
	if name, err := bakeTargetName(" web "); err != nil || name != "web" {
		t.Errorf("got %q %v", name, err)
	}
	if _, err := bakeTargetName("web; rm -rf /"); err == nil {
		t.Error("anything but a plain target name reaches a shell and must be refused")
	}
}

func TestTruncateRunes(t *testing.T) {
	if got := truncateRunes("héllo", 2); got != "hé" {
		t.Errorf("a multi-byte character must not be split, got %q", got)
	}
	if got := truncateRunes("hi", 5); got != "hi" {
		t.Errorf("got %q", got)
	}
}
