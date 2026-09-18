package main

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/orochibraru/homerun/internal/dockerapi"
)

const headSHA = "0123456789abcdef0123456789abcdef01234567"

func ptr(value string) *string { return &value }

// gitSucceeds answers every git step with success, and rev-parse with headSHA.
func gitSucceeds(config dockerapi.ContainerConfig) (int, string) {
	if config.Image == gitImage && strings.Contains(strings.Join(config.Cmd, " "), "rev-parse") {
		return 0, headSHA + "\n"
	}
	return 0, "#1 building\n#2 done\n"
}

func newTestBuilder(docker *fakeDocker) *Builder {
	builder := NewBuilder(docker, "/var/run/docker.sock")
	builder.newID = func() string { return "abcd1234" }
	return builder
}

func TestBuildHappyPathCleansUpAfterItself(t *testing.T) {
	docker := newFakeDocker()
	docker.run = gitSucceeds

	result := newTestBuilder(docker).Build(context.Background(), BuildInput{
		GitURL: "https://github.com/o/r.git",
		Tag:    "svc:1",
	})
	if !result.Success || result.Error != "" {
		t.Fatalf("want success, got %+v", result)
	}
	if result.Commit == nil || *result.Commit != headSHA {
		t.Errorf("the built commit comes from rev-parse, got %v", result.Commit)
	}
	for _, image := range []string{gitImage, tools.HelperImage} {
		if !docker.called("pull " + image) {
			t.Errorf("%s isn't present yet, so it should be pulled", image)
		}
	}
	if !docker.called("create " + gitImage + " clone --depth 1 --branch main") {
		t.Error("an unset ref defaults to main")
	}
	if len(docker.volumes) != 0 {
		t.Errorf("the build volume must be removed, left %v", docker.volumes)
	}
	if len(docker.removed) != docker.containers {
		t.Errorf("every helper container must be removed, created %d removed %d", docker.containers, len(docker.removed))
	}
	if docker.called("push ") {
		t.Error("no push target means no push")
	}
}

func TestBuildRunsTheBuilderWithTheSocketAndTools(t *testing.T) {
	docker := newFakeDocker()
	docker.images[gitImage] = true
	docker.images[tools.HelperImage] = true
	docker.run = gitSucceeds

	result := newTestBuilder(docker).Build(context.Background(), BuildInput{
		BuildMethod: ptr("nixpacks"),
		GitURL:      "https://github.com/o/r.git",
		Tag:         "svc:2",
	})
	if !result.Success {
		t.Fatalf("got %+v", result)
	}
	if docker.called("pull ") {
		t.Error("images already on the daemon aren't pulled again")
	}
	var builder dockerapi.ContainerConfig
	for _, config := range docker.created {
		if config.Image == tools.HelperImage {
			builder = config
		}
	}
	if builder.Cmd[1] != builderScript {
		t.Error("the builder runs the embedded script")
	}
	wantBinds := []string{"homerun-agent-build-abcd1234:/workspace", tools.ToolsVolume + ":/tools", "/var/run/docker.sock:/var/run/docker.sock"}
	if strings.Join(builder.Binds, ",") != strings.Join(wantBinds, ",") {
		t.Errorf("want binds %v, got %v", wantBinds, builder.Binds)
	}
	if !contains(builder.Env, "BUILD_METHOD=nixpacks") {
		t.Errorf("the method reaches the script as a variable, got %v", builder.Env)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

func TestBuildPinsAMovedBranchToTheCheckedCommit(t *testing.T) {
	docker := newFakeDocker()
	docker.run = gitSucceeds
	pinned := strings.Repeat("f", 40)

	result := newTestBuilder(docker).Build(context.Background(), BuildInput{
		Commit: ptr(strings.ToUpper(pinned)),
		GitURL: "https://github.com/o/r.git",
		Tag:    "svc:3",
	})
	if !result.Success || result.Commit == nil || *result.Commit != pinned {
		t.Fatalf("the build is the checked commit or nothing, got %+v", result)
	}
	if !docker.called("create " + gitImage + " -C /workspace/repo checkout --detach " + pinned) {
		t.Error("a branch that moved past the checked commit is pinned back to it")
	}
}

func TestBuildPushesToTheCacheRegistry(t *testing.T) {
	docker := newFakeDocker()
	docker.run = gitSucceeds

	result := newTestBuilder(docker).Build(context.Background(), BuildInput{
		GitURL: "https://github.com/o/r.git",
		Push: &PushTarget{
			Password: "p", RegistryURL: "registry.example.com:5000", Tag: "registry.example.com:5000/svc:4", Username: "robot",
		},
		Tag: "svc:4",
	})
	if !result.Success {
		t.Fatalf("got %+v", result)
	}
	if !docker.called("tag svc:4 registry.example.com:5000/svc:4") {
		t.Errorf("the local image is tagged as the push target, calls %v", docker.calls)
	}
	if !docker.called("push registry.example.com:5000/svc:4 as robot") {
		t.Errorf("and pushed with the registry's credentials, calls %v", docker.calls)
	}
	var builder dockerapi.ContainerConfig
	for _, config := range docker.created {
		if config.Image == tools.HelperImage {
			builder = config
		}
	}
	if !contains(builder.Env, "CACHE_REF=registry.example.com:5000/svc:buildcache") {
		t.Errorf("the push target doubles as the layer cache, env %v", builder.Env)
	}
}

func TestBuildFailuresAreReported(t *testing.T) {
	cases := []struct {
		name    string
		setup   func(*fakeDocker)
		input   BuildInput
		wantErr string
		wantSHA bool
	}{
		{
			name: "a clone that fails",
			setup: func(docker *fakeDocker) {
				docker.run = func(config dockerapi.ContainerConfig) (int, string) {
					return 128, "fatal: Remote branch nope not found\n"
				}
			},
			input:   BuildInput{GitRef: ptr("nope"), GitURL: "https://github.com/o/r.git", Tag: "svc:5"},
			wantErr: "Remote branch nope not found",
		},
		{
			name: "a builder that fails",
			setup: func(docker *fakeDocker) {
				docker.run = func(config dockerapi.ContainerConfig) (int, string) {
					if config.Image == tools.HelperImage {
						return 1, "step 1\n#7 ERROR: failed to solve\nbye\n"
					}
					return gitSucceeds(config)
				}
			},
			input:   BuildInput{GitURL: "https://github.com/o/r.git", Tag: "svc:6"},
			wantErr: "The dockerfile build failed (exit code 1): #7 ERROR: failed to solve",
			wantSHA: true,
		},
		{
			name:    "a pull that fails",
			setup:   func(docker *fakeDocker) { docker.failOn["pull "] = errBoom },
			input:   BuildInput{GitURL: "https://github.com/o/r.git", Tag: "svc:7"},
			wantErr: "boom",
		},
		{
			name:    "an invalid build context",
			setup:   func(docker *fakeDocker) { docker.run = gitSucceeds },
			input:   BuildInput{BuildContext: ptr("../../etc"), GitURL: "https://github.com/o/r.git", Tag: "svc:8"},
			wantErr: "can't leave the repository",
			wantSHA: true,
		},
		{
			name: "a push that fails",
			setup: func(docker *fakeDocker) {
				docker.run = gitSucceeds
				docker.failOn["push "] = errBoom
			},
			input: BuildInput{
				GitURL: "https://github.com/o/r.git",
				Push:   &PushTarget{RegistryURL: "r.example.com", Tag: "r.example.com/svc:9"},
				Tag:    "svc:9",
			},
			wantErr: "boom",
			wantSHA: true,
		},
		{
			name:    "a volume that can't be created",
			setup:   func(docker *fakeDocker) { docker.failOn["volume-create"] = errBoom },
			input:   BuildInput{GitURL: "https://github.com/o/r.git", Tag: "svc:10"},
			wantErr: "boom",
		},
	}
	for _, testCase := range cases {
		docker := newFakeDocker()
		testCase.setup(docker)
		result := newTestBuilder(docker).Build(context.Background(), testCase.input)
		if result.Success {
			t.Errorf("%s: should fail", testCase.name)
			continue
		}
		if !strings.Contains(result.Error, testCase.wantErr) {
			t.Errorf("%s: want an error containing %q, got %q", testCase.name, testCase.wantErr, result.Error)
		}
		if testCase.wantSHA != (result.Commit != nil) {
			t.Errorf("%s: the commit is reported once the clone succeeded, got %v", testCase.name, result.Commit)
		}
		if len(docker.volumes) != 0 {
			t.Errorf("%s: even a failed build removes its volume, left %v", testCase.name, docker.volumes)
		}
	}
}

func TestBuildRedactsTheCredentialFromItsError(t *testing.T) {
	docker := newFakeDocker()
	docker.run = func(dockerapi.ContainerConfig) (int, string) {
		return 128, "fatal: unable to access 'https://bot:SECRET@github.com/o/r.git/': denied\n"
	}
	result := newTestBuilder(docker).Build(context.Background(), BuildInput{
		Credential: &GitCredential{Token: "SECRET", Username: "bot"},
		GitURL:     "https://github.com/o/r.git",
		Tag:        "svc:11",
	})
	if strings.Contains(result.Error, "SECRET") {
		t.Errorf("a provider token must never reach the answer, got %q", result.Error)
	}
	cloned := false
	for _, config := range docker.created {
		if strings.Contains(strings.Join(config.Cmd, " "), "https://bot:SECRET@github.com/o/r.git") {
			cloned = true
		}
	}
	if !cloned {
		t.Error("the credential should still be injected into the clone itself")
	}
}

func TestBuildHonoursAClosedRequest(t *testing.T) {
	docker := newFakeDocker()
	docker.run = gitSucceeds
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	result := newTestBuilder(docker).Build(ctx, BuildInput{GitURL: "https://github.com/o/r.git", Tag: "svc:12"})
	if result.Success {
		t.Error("a cancelled request shouldn't report a build as done")
	}
	if len(docker.volumes) != 0 {
		t.Errorf("cleanup runs on its own context, even for a cancelled request, left %v", docker.volumes)
	}
}

func TestRunGitReportsATimeout(t *testing.T) {
	docker := newFakeDocker()
	builder := newTestBuilder(docker)
	ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
	defer cancel()
	_, _, err := builder.runGit(ctx, []string{"clone"}, "v")
	if err == nil || !strings.Contains(err.Error(), "timed out") {
		t.Errorf("a clone past its deadline should say it timed out, got %v", err)
	}
}

func TestScanLinesAnyEnding(t *testing.T) {
	cases := []struct {
		data  string
		atEOF bool
		want  string
		adv   int
	}{
		{"one\ntwo", false, "one", 4},
		{"one\r\ntwo", false, "one", 5},
		{"one\rtwo", false, "one", 4},
		{"one\r", false, "", 0},
		{"one\r", true, "one", 4},
		{"tail", true, "tail", 4},
		{"partial", false, "", 0},
	}
	for _, testCase := range cases {
		advance, token, _ := scanLinesAnyEnding([]byte(testCase.data), testCase.atEOF)
		if advance != testCase.adv || string(token) != testCase.want {
			t.Errorf("%q (eof=%t): want %d %q, got %d %q",
				testCase.data, testCase.atEOF, testCase.adv, testCase.want, advance, token)
		}
	}
}

func TestRandomIDIsShortHex(t *testing.T) {
	id := randomID()
	if len(id) != 8 || strings.Trim(id, "0123456789abcdef") != "" {
		t.Errorf("want 8 hex characters, got %q", id)
	}
	if randomID() == id {
		t.Error("two ids should differ")
	}
}
