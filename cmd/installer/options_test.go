package main

import (
	"strings"
	"testing"
)

func TestParseArgsDefaults(t *testing.T) {
	opts, help, err := ParseArgs(nil)
	if err != nil || help {
		t.Fatalf("no arguments should parse cleanly, got help=%t err=%v", help, err)
	}
	if opts.Mode != ModeAgent {
		t.Errorf("default mode should be agent, got %q", opts.Mode)
	}
	if opts.AgentPort != 7420 {
		t.Errorf("default port should be 7420, got %d", opts.AgentPort)
	}
	if opts.RootlessUser != "homerun" {
		t.Errorf("default user should be homerun, got %q", opts.RootlessUser)
	}
	if opts.Version != "latest" {
		t.Errorf("default version should be latest, got %q", opts.Version)
	}
	if opts.DryRun || opts.Yes || opts.MigrateToRootful {
		t.Errorf("no boolean flag should default on, got %+v", opts)
	}
}

func TestParseArgsFlags(t *testing.T) {
	opts, _, err := ParseArgs([]string{
		"--mode=full", "--docker=rootless", "--dry-run", "-y",
		"--domain=homerun.example.com", "--user=deployer", "--port=9000",
		"--version=v1.2.3", "--image=local/homerun:dev", "--advertise-addr=10.0.0.5",
	})
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	for name, check := range map[string]bool{
		"mode":      opts.Mode == ModeFull,
		"docker":    opts.Docker == FlavourRootless,
		"dry run":   opts.DryRun,
		"yes":       opts.Yes,
		"domain":    opts.Domain == "homerun.example.com",
		"user":      opts.RootlessUser == "deployer",
		"port":      opts.AgentPort == 9000,
		"version":   opts.Version == "v1.2.3",
		"image":     opts.Image == "local/homerun:dev",
		"advertise": opts.AdvertiseAddress == "10.0.0.5",
	} {
		if !check {
			t.Errorf("%s not parsed: %+v", name, opts)
		}
	}
}

func TestParseArgsMigrateImpliesFullMode(t *testing.T) {
	opts, _, err := ParseArgs([]string{"--migrate-to-rootful"})
	if err != nil {
		t.Fatal(err)
	}
	if !opts.MigrateToRootful || opts.Mode != ModeFull {
		t.Errorf("--migrate-to-rootful implies --mode=full, got %+v", opts)
	}
}

func TestParseArgsHelpAndErrors(t *testing.T) {
	for _, arg := range []string{"--help", "-h"} {
		if _, help, err := ParseArgs([]string{arg}); !help || err != nil {
			t.Errorf("%s should ask for help, got help=%t err=%v", arg, help, err)
		}
	}

	if _, _, err := ParseArgs([]string{"--nope"}); err == nil {
		t.Error("an unknown argument should be rejected")
	} else if !strings.Contains(err.Error(), "--nope") {
		t.Errorf("the error should name the argument, got %q", err)
	}

	if _, _, err := ParseArgs([]string{"--port=many"}); err == nil {
		t.Error("a non-numeric --port= should be rejected")
	}
}

func TestDockerFlavourOf(t *testing.T) {
	cases := []struct {
		name string
		opts Options
		want DockerFlavour
	}{
		{"agent is always rootless", Options{Mode: ModeAgent}, FlavourRootless},
		{"agent ignores an explicit flavour", Options{Mode: ModeAgent, Docker: FlavourRootful}, FlavourRootless},
		{"full defaults to rootful", Options{Mode: ModeFull}, FlavourRootful},
		{"full honours rootless", Options{Mode: ModeFull, Docker: FlavourRootless}, FlavourRootless},
	}
	for _, testCase := range cases {
		if got := DockerFlavourOf(testCase.opts); got != testCase.want {
			t.Errorf("%s: want %q, got %q", testCase.name, testCase.want, got)
		}
	}
}

func TestValidate(t *testing.T) {
	cases := []struct {
		name    string
		opts    Options
		wantErr string
	}{
		{"valid agent install", Options{Mode: ModeAgent}, ""},
		{"valid full install", Options{Mode: ModeFull, Docker: FlavourRootful}, ""},
		{
			"--docker on an agent install",
			Options{Mode: ModeAgent, Docker: FlavourRootful},
			"only applies to --mode=full",
		},
		{
			"--migrate-to-rootful with --docker=rootless",
			Options{Mode: ModeFull, Docker: FlavourRootless, MigrateToRootful: true},
			"drop --docker=rootless",
		},
		{
			"--advertise-addr without a swarm",
			Options{Mode: ModeFull, Docker: FlavourRootless, AdvertiseAddress: "10.0.0.5"},
			"only applies to a rootful --mode=full install",
		},
		{
			"--advertise-addr on an agent install",
			Options{Mode: ModeAgent, AdvertiseAddress: "10.0.0.5"},
			"only applies to a rootful --mode=full install",
		},
	}
	for _, testCase := range cases {
		got := Validate(testCase.opts)
		if testCase.wantErr == "" && got != "" {
			t.Errorf("%s: expected valid, got %q", testCase.name, got)
		}
		if testCase.wantErr != "" && !strings.Contains(got, testCase.wantErr) {
			t.Errorf("%s: want a message containing %q, got %q", testCase.name, testCase.wantErr, got)
		}
	}
}

func TestHelpTextCoversEveryFlag(t *testing.T) {
	for _, flag := range []string{
		"--version=", "--mode=agent|full", "--domain=", "--docker=rootless|rootful",
		"--advertise-addr=", "--migrate-to-rootful", "--image=", "--user=", "--port=",
		"--dry-run", "--yes",
	} {
		if !strings.Contains(helpText, flag) {
			t.Errorf("--help doesn't document %s", flag)
		}
	}
}
